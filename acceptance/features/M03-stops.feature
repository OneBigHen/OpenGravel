@web @plan
Feature: Stops along a route
  As a rider shaping a day out
  I want to add, remove and reorder stops
  So that the route passes through the places I care about

  Scenario: Stops reshape the committed route
    Given a planned route with a start and destination
    When the rider adds a stop between them
    Then the route passes through the stop
    And the stop can be removed or reordered afterwards
