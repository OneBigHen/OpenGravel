@critical @web @device
Feature: Import and export GPX
  As a rider with routes from other tools
  I want GPX in and out of my library
  So that my routes stay portable

  Scenario: GPX round trip through the library
    Given a GPX file from another tool
    When the rider imports it into the library
    Then the imported route appears in the library
    And the rider can export it back to GPX
