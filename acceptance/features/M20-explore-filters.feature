@web @explore
Feature: Explore filters
  As a rider with specific tastes
  I want to filter the catalog
  So that I only see rides I would take

  Scenario: Filters narrow the catalog
    Given the explore catalog is loaded
    When the rider filters by surface, distance and region
    Then only matching routes are listed
    And the filters are reflected in the URL
    And an empty result offers a way to clear the filters
