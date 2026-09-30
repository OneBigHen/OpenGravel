@web @plan
Feature: Draw a route freehand
  As a rider with a line in mind
  I want to draw on the map
  So that planning follows my drawn line

  Scenario: Planning follows the drawn line
    Given the rider has drawn a line on the map
    When the rider plans from the drawing
    Then the committed route follows the drawn checkpoints
    And GPX export keeps the full drawn line
