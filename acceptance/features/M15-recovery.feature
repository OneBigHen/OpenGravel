@critical @web @ride @device
Feature: Session recovery
  As a rider whose phone rebooted or browser reloaded
  I want my ride and draft back
  So that nothing is lost mid-day

  Scenario: Reload during recording recovers the ride
    Given a recording is in progress
    When the page reloads
    Then the recording is recovered
    And the recorded distance is preserved

  Scenario: Planner draft survives reload
    Given the planner has an unsaved draft
    When the page reloads
    Then the draft is restored
