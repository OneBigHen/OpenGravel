@critical @web @device
# iOS lane stays "planned": importing needs a real document picker and a GPX
# file on the device, which is not deterministic on the simulator. The
# deterministic assertions live in tests/e2e/critical/import-export.spec.ts
# and tests/e2e/critical/gpx-sharing.spec.ts.
Feature: Import and export GPX
  As a rider with routes from other tools
  I want GPX in and out of my library
  So that my routes stay portable

  Scenario: GPX round trip through the library
    Given a GPX file from another tool
    When the rider imports it into the library
    Then the imported route appears in the library
    And the rider can export it back to GPX

  Scenario: A multi-track import keeps its warnings and waypoints honest
    Given a GPX file with several tracks, a gap and a waypoint
    When the rider imports it
    Then each track is offered for import
    And the import says which warnings it kept
    And the waypoint is preserved as metadata, not merged into the track geometry
    And the imported ride is named after the chosen track, not the file

  Scenario: An exported GPX re-imports cleanly
    Given a ride imported from GPX
    When the rider exports it to GPX and imports the export again
    Then the re-import offers the same tracks

  Scenario: Hostile GPX is rejected without saving anything
    Given a GPX file with external entities
    When the rider imports it
    Then nothing is saved
    And the rider is told why

  Scenario: Hostile GPX names never become public names
    Given a GPX file with a hostile ride name
    When the rider imports it
    Then the name renders as inert text
    And it is rejected as a public name

  Scenario: Shared rides carry their provenance honestly
    Given a shared ride
    Then the share state is visible on the ride
    And shared content carries the unchecked-content disclaimer
