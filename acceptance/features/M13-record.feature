@critical @ride @ios @web @device
Feature: Record a ride
  As a rider who just wants to ride
  I want the app to record my track
  So that I keep the ride afterwards

  Scenario: Record, pause, resume, finish and export
    Given the rider has a GPS fix
    When the rider records a ride
    Then the ride records the travelled track
    When the rider pauses and resumes
    Then recording continues from the pause point
    When the rider finishes the ride
    Then the recorded ride is saved to the library
    And the recorded ride can be exported as GPX
