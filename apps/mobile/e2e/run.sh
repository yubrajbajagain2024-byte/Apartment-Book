#!/bin/sh
# Relaunch the project in Expo Go on the booted simulator, then run the given Maestro flows.
# Usage: e2e/run.sh e2e/flows/00-signed-out.yaml [more flows…]   (env: EMAIL, PASSWORD for login flows)
set -e
xcrun simctl terminate booted host.exp.Exponent 2>/dev/null || true
sleep 1
xcrun simctl openurl booted "exp://127.0.0.1:8081"
sleep 4
exec "$HOME/.maestro/bin/maestro" test "$@"
