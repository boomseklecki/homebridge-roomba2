# Changelog

## 1.4.0

### Minor Changes

- 8edc43f: Change terminology from "watch" to "poll"
- 1bfd4d1: Keep checking Roomba's status frequently for two minutes after it has been active [#112]
- aa07d0e: Fix upstream dorita980 to fix node 18 TLS fault when connecting to Roomba
- eb29f42: Upgrade dorita980 to resolve Node 18 connection issues [#126]
- bd7c6c1: Add cipher to dorita980 to support J7 [#106]
- 5e9a0f2: Make the idle watch interval configurable
- 64a137b: Support evac phase [#114]
- 931ba0d: Make starting Roomba more reliable by tacking whether a clean cycle is paused
- 63a3a40: Decrease the frequency of Roomba status queries when Roomba is idle [#112]

  Based on work by @Write. Also tidied up the handling of async in the connect method
  and re-wrote the status watching approach.

### Patch Changes

- 09ef460: Don't use state from cache if we want to force a refresh
- c438513: Change max cache age to reflect current polling rate
- 342a814: Fix custom dorita980 dependency
- 80c790b: Simplify robot password script running
- b646681: Fix too many close listeners warning when refreshing state
- 6f697d0: Don't double-log connect timeouts
- 7cc3440: Fix Homebridge crash due to ECONNREFUSED is dorita980 cannot connect to Roomba
- 27dc29b: Refactor watch loop to ensure no double-ups
- 404bb02: Fix "Releasing an unexpected Roomba instance" logging after a timeout
- e1989e4: Update to node 18 and upgrade dependencies

## 1.3.2-beta.5

### Patch Changes

- c438513: Change max cache age to reflect current polling rate
- 8edc43f: Change terminology from "watch" to "poll"
- 27dc29b: Refactor watch loop to ensure no double-ups

## 1.3.2-beta.4

### Patch Changes

- 1bfd4d1: Keep checking Roomba's status frequently for two minutes after it has been active [#112]
- 931ba0d: Make starting Roomba more reliable by tacking whether a clean cycle is paused

## 1.3.2-beta.3

### Patch Changes

- b646681: Fix too many close listeners warning when refreshing state
- 7cc3440: Fix Homebridge crash due to ECONNREFUSED is dorita980 cannot connect to Roomba
- 5e9a0f2: Make the idle watch interval configurable
- 63a3a40: Decrease the frequency of Roomba status queries when Roomba is idle [#112]

  Based on work by @Write. Also tidied up the handling of async in the connect method
  and re-wrote the status watching approach.

## 1.3.2-beta.2

### Patch Changes

- 64a137b: Support evac phase [#114]

## 1.3.2-beta.1

### Patch Changes

- 342a814: Fix custom dorita980 dependency

## 1.3.2-beta.0

### Patch Changes

- 09ef460: Don't use state from cache if we want to force a refresh
- 80c790b: Simplify robot password script running
- aa07d0e: Fix upstream dorita980 to fix node 18 TLS fault when connecting to Roomba
- eb29f42: Upgrade dorita980 to resolve Node 18 connection issues [#126]
- bd7c6c1: Add cipher to dorita980 to support J7 [#106]
- 6f697d0: Don't double-log connect timeouts
- 404bb02: Fix "Releasing an unexpected Roomba instance" logging after a timeout
- e1989e4: Update to node 18 and upgrade dependencies

## 1.3.1

### Patch Changes

- d69dcf0: Reduce info logging so the plugin is a lot quieter when not in debug logging mode
- 438e99c: Add debug option to config schema

## 1.3.0

### Minor Changes

- ae578c0: Refactor Roomba connection handling to improve reporting of issues connecting to Roomba and to reuse
  existing Roomba connections to avoid conflicts [#66]
- e7f574c: Organise config schema into sections and rename options
- 5ab1507: Increase the frequency of Roomba status checks in order to support automations
- 2863a49: Rename noDockOnStop to dockOnStop [#73 #74] (thanks @rcoletti116, @khad)
- f15404e: Added support for Identify method (supported in 3rd party HomeKit apps)
- 3e9e48b: Include a resume command when starting cleaning so we can cope with a paused Roomba
- 44c6f8a: Actively watch Roomba's status and update HomeKit for a short period of time after being inspected

  HomeKit inspects Roomba when you open the Home app, but it doesn't continously poll for changes
  so the plugin now watches Roomba for changes and pushes them to the Home app.

- b7322c0: Add docking contact sensor
- 721c3a6: Add a setting to control whether Roomba is sent home when stopped [#63] (thanks @rcoletti116)
- 0e87755: Add Home switch as separate to docking contact sensor
- 28eeeec: Report current plugin version as the firmware version
- 8ab5243: Change docking sensor to a switch so you can trigger docking
- e32d078: Add a long-term slow watching of Roomba's status so we always have a status
- 44c026c: Stop behaviour now checks what state Roomba is in and no longer triggers a docking if Roomba is already docked
- aac6159: Change state refresh approach to be on demand rather than constant polling
  or keeping a permanent connection.
- 6dbb668: Convert to using TypeScript and pnpm for development
- 853b39e: Overhauled Roomba connections and status again, status gathering is now more passive

### Patch Changes

- Enable serial number to be specified in the configuration
- Change the manufacturer reported to HomeKit to iRobot
- f71c085: Add source code linting
- 05ca4e6: Improve handling around connections to Roomba that timeout
- b3a25b0: Debug logging improvements and re-including the raw status in debug logs
- 58cba16: Improve Roomba connection handling
- 032098a: Improve the log message when Roomba fails to complete a docking manoeuvre
- e623a28: Rename Docked contact sensor to Dock
- 1f02665: Improve the default name of the Bin Full sensor
- b9daed9: Recognise more Roomba phases, including more docking phases and stuck
- 73b02d3: Add a timeout when waiting for the full status from Roomba so we release our connection to Roomba
- c8ce152: Only update characteristics with changes
- e79b7a3: Update dependencies
- 477f571: Upgrade dependencies including dorita980 to address #81
- f100e9f: Refresh Roomba's status after every action so we update our version of Roomba's state ASAP.

  The previous approach of updating the state directly had a race condition with pre-existing updates of Roomba's state.

- 5399dbb: Fix delay when trying to dock
- 1346008: Logging more efficient and added a switch to enable easier debug logging

## 1.3.0-beta.11

### Patch Changes

- 477f571: Upgrade dependencies including dorita980 to address #81

## 1.3.0-beta.10

### Minor Changes

- e7f574c: Organise config schema into sections and rename options
- 0e87755: Add Home switch as separate to docking contact sensor

## 1.3.0-beta.9

### Minor Changes

- 8ab5243: Change docking sensor to a switch so you can trigger docking

## 1.3.0-beta.8

### Minor Changes

- 5ab1507: Increase the frequency of Roomba status checks in order to support automations

### Patch Changes

- 05ca4e6: Improve handling around connections to Roomba that timeout
- f100e9f: Refresh Roomba's status after every action so we update our version of Roomba's state ASAP.

  The previous approach of updating the state directly had a race condition with pre-existing updates of Roomba's state.

## 1.3.0-beta.7

### Minor Changes

- 2863a49: Rename noDockOnStop to dockOnStop [#73 #74] (thanks @rcoletti116, @khad)

## 1.3.0-beta.6

### Minor Changes

- e32d078: Add a long-term slow watching of Roomba's status so we always have a status

## 1.3.0-beta.5

### Patch Changes

- 73b02d3: Add a timeout when waiting for the full status from Roomba so we release our connection to Roomba
- c8ce152: Only update characteristics with changes

## 1.3.0-beta.4

### Patch Changes

- b3a25b0: Debug logging improvements and re-including the raw status in debug logs

## 1.3.0-beta.3

### Minor Changes

- 853b39e: Overhauled Roomba connections and status again, status gathering is now more passive

### Patch Changes

- 5399dbb: Fix delay when trying to dock

## 1.3.0-beta.2

### Minor Changes

- 721c3a6: Add a setting to control whether Roomba is sent home when stopped [#63] (thanks @rcoletti116)
- 44c026c: Stop behaviour now checks what state Roomba is in and no longer triggers a docking if Roomba is already docked

### Patch Changes

- b9daed9: Recognise more Roomba phases, including more docking phases and stuck

## 1.3.0-beta.1

### Patch Changes

- 58cba16: Improve Roomba connection handling

## 1.3.0-beta.0

### Minor Changes

- ae578c0: Refactor Roomba connection handling to improve reporting of issues connecting to Roomba and to reuse
  existing Roomba connections to avoid conflicts [#66]
- 3e9e48b: Include a resume command when starting cleaning so we can cope with a paused Roomba
- 44c6f8a: Actively watch Roomba's status and update HomeKit for a short period of time after being inspected

  HomeKit inspects Roomba when you open the Home app, but it doesn't continously poll for changes
  so the plugin now watches Roomba for changes and pushes them to the Home app.

- b7322c0: Add docking contact sensor
- 28eeeec: Report current plugin version as the firmware version
- aac6159: Change state refresh approach to be on demand rather than constant polling
  or keeping a permanent connection.
- 6dbb668: Convert to using TypeScript and pnpm for development

### Patch Changes

- Enable serial number to be specified in the configuration
- Change the manufacturer reported to HomeKit to iRobot
- f71c085: Add source code linting
- 032098a: Improve the log message when Roomba fails to complete a docking manoeuvre
- e623a28: Rename Docked contact sensor to Dock
- 1f02665: Improve the default name of the Bin Full sensor
- e79b7a3: Update dependencies
- 1346008: Logging more efficient and added a switch to enable easier debug logging

## 1.2.2

### Patch Changes

- 50a3640: Updated sample-config.json with accurate plugins section [#47]
- 450333e: Change the logging of each status request to debug level to reduce log noise [#50]
- 20d74fc: Fix double calling of the callback when using an expired status [#49]

## 1.2.1 (2021-02-01)

- Fix filterMaintenance service not being published properly, thanks @m-ruhl [#24]

## 1.2.0 (2020-05-12)

- Fixes #10 (Thank you @dvcrn) [PR: #16]

## 1.1.0 (2020-10-29)

- Added support for bin full notifications.

## 1.0.0 (2020-10-28)

- Plugin verified

## 0.0.2 (2020-10-28)

- Fixed (#1)

- Fied a typo in config.schema.json line 34, thanks @benasher44

## 0.0.1 (2020-10-20)

- Base plugin

- Added Contact sensor for running/docked notifications in home app, thanks @ncovercash
