@web
Feature: My rides library
  As a rider building a collection
  I want my rides saved and organized
  So that I can find and reuse them

  Scenario: Save, rename and annotate a ride
    Given a finished or imported ride
    When the rider saves it with a name
    Then it appears in the library
    And the rider can rename it and add notes and a rating

  Scenario: Empty library explains itself
    Given the rider has no saved rides
    When the rider opens the library
    Then an empty state invites the first ride
