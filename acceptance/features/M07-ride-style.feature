@web @plan
Feature: Ride style and bike profile
  As a rider on a specific bike
  I want the plan to respect my bike's range and style
  So that the route is rideable

  Scenario: Bike range shapes the briefing
    Given the rider has chosen a bike profile with a known range
    When the rider plans a route
    Then the briefing reflects that bike's range
    And a route beyond usable range raises a fuel warning
