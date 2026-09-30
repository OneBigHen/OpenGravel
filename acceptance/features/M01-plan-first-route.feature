@critical @web @plan
Feature: Plan a first route
  As a rider opening OpenGravel
  I want to set a start and a destination
  So that I get a visible, selectable route

  Scenario: Route appears and is selectable
    Given the planner is open
    When the rider sets a start point and a destination
    Then at least one route is visible on the map
    And the rider can select the route

  Scenario: Planning can be cancelled while in flight
    Given the rider has set a start and destination
    And the route plan is still being computed
    When the rider cancels planning
    Then no route is committed
    And the planner returns to its pre-plan state
