"""Run with the same pyosmium environment used for hike-access.py."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class HikeAccessTest(unittest.TestCase):
    def test_explicit_no_overrides_foot_but_motor_restrictions_do_not(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "input.osm"
            output = Path(tmp) / "output.osm"
            source.write_text('''<osm version="0.6"><node id="1" lat="40" lon="-75"/>
              <way id="1"><nd ref="1"/><tag k="access" v="no"/><tag k="foot" v="designated"/></way>
              <way id="2"><nd ref="1"/><tag k="motor_vehicle" v="no"/><tag k="foot" v="yes"/></way></osm>''')
            script = Path(__file__).with_name("hike-access.py")
            subprocess.run([sys.executable, str(script), str(source), str(output)], check=True, capture_output=True)
            result = output.read_text()
            first, second = result.split('<way id="2">')
            self.assertIn('<tag k="foot" v="no"/>', first)
            self.assertIn('<tag k="foot" v="yes"/>', second)
            self.assertIn('<tag k="motor_vehicle" v="no"/>', second)


if __name__ == "__main__":
    unittest.main()
