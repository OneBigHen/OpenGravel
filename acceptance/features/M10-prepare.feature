@web @ride @network
Feature: Pre-ride preparation
  As a rider about to leave
  I want weather, traffic and readiness in one place
  So that I leave informed, not surprised

  Scenario: Preparation shows ride-day conditions
    Given a planned route
    When the rider opens preparation
    Then current weather along the route is shown
    And traffic status is shown
    And offline readiness is stated honestly
