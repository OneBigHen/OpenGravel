@web @network
Feature: Map resilience
  As a rider with a flaky connection
  I want the map to fail honestly
  So that I know what I am looking at

  Scenario: Tile or provider failure is surfaced
    Given a map dependency is unavailable
    When the map cannot render its layers
    Then the failure is surfaced to the rider
    And the map never presents stale tiles as current
