// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Step-up challenge creation and state management via Redis and PostgreSQL.

package internal

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const challengeTTL = 5 * time.Minute

// challengeState is the in-memory representation of an active step-up challenge.
type challengeState struct {
	ID            string
	ZoneID        string
	SessionID     string
	ChallengeType string
	ExpiresAt     time.Time
}

// createChallenge persists a new step-up challenge to Redis (TTL) and PostgreSQL (audit).
func (s *Server) createChallenge(ctx context.Context, zoneID, sessionID, challengeType string) (*challengeState, error) {
	id, _ := uuid.NewV7()
	c := &challengeState{
		ID:            id.String(),
		ZoneID:        zoneID,
		SessionID:     sessionID,
		ChallengeType: challengeType,
		ExpiresAt:     time.Now().Add(challengeTTL),
	}

	if err := s.redis.SetTTL(ctx, "stepup:"+c.ID, c, challengeTTL); err != nil {
		return nil, err
	}

	if err := s.db.InsertStepUpChallenge(ctx, &StepUpChallengePG{
		ID:            c.ID,
		ZoneID:        zoneID,
		SessionID:     sessionID,
		ChallengeType: challengeType,
		ExpiresAt:     c.ExpiresAt,
	}); err != nil {
		return nil, err
	}

	return c, nil
}
