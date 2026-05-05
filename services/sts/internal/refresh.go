// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Brokered credential refresh: retries OAuth token exchange on expiry.

package internal

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	sharederr "github.com/garudex-labs/caracal/shared/errors"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	providerRefreshTimeout  = 5 * time.Second
	providerRefreshAttempts = 2
	providerCircuitTTL      = 30 * time.Second
	providerFailureTTL      = 5 * time.Minute
	providerFailureLimit    = int64(5)
)

func sealZEK(zek, plaintext []byte) ([]byte, error) {
	aead, err := chacha20poly1305.New(zek)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := aead.Seal(nil, nonce, plaintext, nil)
	return append(nonce, ct...), nil
}

func openZEK(zek, packed []byte) ([]byte, error) {
	aead, err := chacha20poly1305.New(zek)
	if err != nil {
		return nil, err
	}
	ns := aead.NonceSize()
	if len(packed) < ns {
		return nil, errors.New("ciphertext too short")
	}
	return aead.Open(nil, packed[:ns], packed[ns:], nil)
}

// tryRefreshBrokeredGrant fetches the delegated grant for userID+resourceID,
// refreshes the provider access token if expired, and updates the grant.
// Returns nil if no grant exists or the token is still valid.
// Returns CredentialExpired if refresh fails.
func (s *Server) tryRefreshBrokeredGrant(ctx context.Context, zoneID, userID, resourceID string) *sharederr.CaracalError {
	if userID == "" {
		return nil
	}
	grant, err := s.db.GetDelegatedGrant(ctx, zoneID, userID, resourceID)
	if err != nil {
		return nil
	}
	if grant.ExpiresAt != nil && grant.ExpiresAt.After(time.Now()) {
		return nil
	}
	if len(grant.RefreshTokenCt) == 0 || grant.ProviderID == nil {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	provider, err := s.db.GetProvider(ctx, *grant.ProviderID)
	if err != nil {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	var provCfg struct {
		TokenEndpoint     string   `json:"token_endpoint"`
		AllowedTokenHosts []string `json:"allowed_token_hosts"`
	}
	if err := json.Unmarshal(provider.ConfigJSON, &provCfg); err != nil || provCfg.TokenEndpoint == "" {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	tokenEndpoint, err := validateTokenEndpoint(provCfg.TokenEndpoint, provCfg.AllowedTokenHosts)
	if err != nil {
		return sharederr.New(sharederr.CredentialExpired, "credential endpoint not allowed")
	}
	if s.providerCircuitOpen(ctx, provider.ID) {
		return sharederr.New(sharederr.CredentialExpired, "provider refresh circuit open")
	}
	refreshToken, err := openZEK(s.keys.zek, grant.RefreshTokenCt)
	if err != nil {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {string(refreshToken)}}
	body, err := s.refreshProviderToken(ctx, provider.ID, tokenEndpoint, form)
	if err != nil {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenResp); err != nil || tokenResp.AccessToken == "" {
		return sharederr.New(sharederr.CredentialExpired, "credential_expired_not_renewable")
	}
	newAccessCt, err := sealZEK(s.keys.zek, []byte(tokenResp.AccessToken))
	if err != nil {
		return sharederr.New(sharederr.Internal, "token re-encryption failed")
	}
	newRefresh := tokenResp.RefreshToken
	if newRefresh == "" {
		newRefresh = string(refreshToken)
	}
	newRefreshCt, err := sealZEK(s.keys.zek, []byte(newRefresh))
	if err != nil {
		return sharederr.New(sharederr.Internal, "token re-encryption failed")
	}
	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	if err := s.db.UpdateGrantTokens(ctx, grant.ID, grant.RefreshTokenVersion, newAccessCt, newRefreshCt, expiresAt); err != nil {
		return sharederr.New(sharederr.Internal, "grant update failed")
	}
	return nil
}

func validateTokenEndpoint(raw string, allowedHosts []string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "https" || u.Hostname() == "" {
		return nil, fmt.Errorf("provider token endpoint must be https")
	}
	if len(allowedHosts) == 0 {
		return u, nil
	}
	for _, host := range allowedHosts {
		if strings.EqualFold(strings.TrimSpace(host), u.Hostname()) {
			return u, nil
		}
	}
	return nil, fmt.Errorf("provider token endpoint host is not allowlisted")
}

func (s *Server) refreshProviderToken(ctx context.Context, providerID string, endpoint *url.URL, form url.Values) ([]byte, error) {
	client := &http.Client{Timeout: providerRefreshTimeout}
	var lastErr error
	for attempt := 0; attempt < providerRefreshAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(form.Encode()))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode == http.StatusOK {
			s.clearProviderFailures(ctx, providerID)
			return body, nil
		}
		lastErr = fmt.Errorf("provider token endpoint returned %d", resp.StatusCode)
	}
	s.recordProviderFailure(ctx, providerID)
	return nil, lastErr
}

func (s *Server) providerCircuitOpen(ctx context.Context, providerID string) bool {
	if s.redis == nil {
		return false
	}
	open, err := s.redis.Exists(ctx, "provider-refresh-circuit:"+providerID)
	return err == nil && open
}

func (s *Server) recordProviderFailure(ctx context.Context, providerID string) {
	if s.redis == nil {
		return
	}
	key := "provider-refresh-failures:" + providerID
	count, err := s.redis.IncrWithExpiry(ctx, key, providerFailureTTL)
	if err == nil && count >= providerFailureLimit {
		_ = s.redis.SetTTL(ctx, "provider-refresh-circuit:"+providerID, "open", providerCircuitTTL)
	}
}

func (s *Server) clearProviderFailures(ctx context.Context, providerID string) {
	if s.redis == nil {
		return
	}
	_ = s.redis.Del(ctx, "provider-refresh-failures:"+providerID)
	_ = s.redis.Del(ctx, "provider-refresh-circuit:"+providerID)
}
