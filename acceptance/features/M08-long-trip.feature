@web @plan
Feature: Long-trip planning
  As a rider planning a multi-stop day
  I want fuel and feasibility handled up front
  So that the trip does not strand me

  Scenario: Long trip surfaces fuel stops
    Given a route longer than the bike's usable range
    When the rider reviews the plan
    Then planned fuel stops are shown
    And long-trip considerations are listed before the ride starts
