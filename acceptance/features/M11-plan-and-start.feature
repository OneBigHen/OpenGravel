@critical @ride @ios @web
Feature: Plan a ride and start it
  As a rider with a route ready
  I want to start the ride from the plan
  So that turn-by-turn navigation begins

  Scenario: Planned route starts a ride
    Given a planned route that is ride ready
    When the rider starts the ride
    Then the ride surface opens
    And the device position is acquired
