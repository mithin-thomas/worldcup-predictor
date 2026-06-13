package httpapi

import "time"

// now is overridable in tests for deterministic lock-state assertions.
var now = func() time.Time { return time.Now().UTC() }
