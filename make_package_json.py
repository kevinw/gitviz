import sys
import os.path
import json
from collections import OrderedDict

assert os.path.isdir('node_modules')

dependencies = {}

for f in os.listdir('node_modules'):
    d = os.path.join('node_modules', f)
    package_json = os.path.join(d, 'package.json')
    if os.path.isfile(package_json):
        package = json.loads(open(package_json, 'rb').read().decode('utf8'))
        dependencies[package['name']] = package['version']

print json.dumps(OrderedDict([
    ('name', sys.argv[1]),
    ('version', sys.argv[2]),
    ('dependencies', dependencies)
]), indent=4)
