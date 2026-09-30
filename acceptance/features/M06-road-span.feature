@web @plan
Feature: Road spans
  As a rider who knows a good road
  I want to mark a road span
  So that plans prefer riding it

  Scenario: A marked span influences the plan
    Given a rider has marked a road span
    When the rider plans a route nearby
    Then the committed route uses the marked span where it makes sense
