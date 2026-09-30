@critical @ride @ios @web
Feature: Ride continuity
  Scenario: Resume a ride midway through the route
    Given a rider has progressed beyond the route midpoint
    And the ride has been paused
    When the rider resumes the ride
    Then navigation should resume from the rider's current position
    And navigation should not route back to the original starting point

  Scenario: Relaunching the app restores a paused ride
    Given a ride is paused
    When the app is closed and reopened
    Then the paused ride is restored
    And resuming continues from the rider's current position
