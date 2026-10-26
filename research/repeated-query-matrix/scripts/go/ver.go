package main

import "runtime/debug"

func readGinVersion() (string, bool) {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "", false
	}
	for _, d := range bi.Deps {
		if d.Path == "github.com/gin-gonic/gin" {
			return "gin " + d.Version, true
		}
	}
	return "", false
}
