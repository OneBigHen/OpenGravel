@web @device
Feature: SwitchBack import
  As a SwitchBack user
  I want my tracks imported
  So that I can ride them in OpenGravel

  Scenario: SwitchBack tracks are imported
    Given SwitchBack tracks are available
    When the rider imports from SwitchBack
    Then the rider can choose which tracks to import
    And the import completes into the library
