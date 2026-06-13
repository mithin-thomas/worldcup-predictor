// Package sportsapi is the API-Football client and the pure mapping of its
// JSON into SayScore domain values. It does not import the store.
package sportsapi

import "time"

type Stage string

const (
	StageGroup    Stage = "group"
	StageKnockout Stage = "knockout"
)

type Status string

const (
	StatusScheduled Status = "scheduled"
	StatusLive      Status = "live"
	StatusFinal     Status = "final"
)

type Team struct {
	APITeamID int64
	Name      string
	Code      string
	LogoURL   string
}

type Fixture struct {
	APIFixtureID  int64
	Stage         Stage
	Round         string
	HomeAPITeamID int64
	AwayAPITeamID int64
	KickoffUTC    time.Time
	Status        Status
	HomeScore     *int32
	AwayScore     *int32
}
