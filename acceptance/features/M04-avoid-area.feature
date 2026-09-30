@web @plan
Feature: Avoid areas
  As a rider who knows a bad stretch of road
  I want to mark an area to avoid
  So that the planned route goes around it

  Scenario: Route avoids a marked area
    Given a planned route that crosses an area
    When the rider marks that area as avoided
    Then the replanned route does not enter the area
    And removing the avoid area restores the original shape
