import shutil
import json
from pathlib import Path
import jinja2

ROOT = Path(__file__).parent
TEMPLATES = ROOT / "templates"
OUTPUT = ROOT / "public"
CONFIG = ROOT / "config.json"

with CONFIG.open(encoding="utf-8") as config_file:
    data = json.load(config_file)

if OUTPUT.exists():
    shutil.rmtree(OUTPUT)
OUTPUT.mkdir(parents=True)

env = jinja2.Environment(loader=jinja2.FileSystemLoader(TEMPLATES))

# Iterate through all HTML templates
for template_path in TEMPLATES.rglob("*.html"):
    # Skip partials/layouts (convention: prefix with underscore)
    if template_path.name.startswith("_") or template_path == TEMPLATES / "base.html":
        continue

    # Calculate relative path (e.g., about/index.html)
    rel_path = template_path.relative_to(TEMPLATES)
    
    # Destination file in public/
    dest_file = OUTPUT / rel_path
    dest_file.parent.mkdir(parents=True, exist_ok=True)

    # Render template (using forward slashes for Jinja loader)
    template_str = str(rel_path).replace("\\", "/")
    template = env.get_template(template_str)
    
    # Pass global or page-specific data here
    rendered = template.render(
        data=data,
        base_url="",
        request_path=rel_path.as_posix(),
        dialogs=data.get("dialogs", []),
    )
    dest_file.write_text(rendered, encoding="utf-8")
    print(f"Built: {rel_path}")

# Copy static assets
static_dir = ROOT / "static"
if static_dir.exists():
    shutil.copytree(static_dir, OUTPUT / "static")
