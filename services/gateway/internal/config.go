// Copyright (C) 2026 Garudex Labs.  All Rights Reserved.
// Caracal, a product of Garudex Labs
//
// Gateway service configuration.

package internal

import "github.com/garudex-labs/caracal/shared/config"

type Config struct {
	config.Base
	STSURL string
}

func loadConfig() Config {
	return Config{
		Base:   config.Load(),
		STSURL: config.MustGetenv("STS_URL"),
	}
}
