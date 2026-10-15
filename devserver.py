from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os


class CustomHandler(SimpleHTTPRequestHandler):

  def send_error(self, code, message=None, explain=None):
    if code == 404:
      error_path = os.path.join(self.directory, "404.html")
      if os.path.exists(error_path):
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        with open(error_path, "rb") as f:
          self.copyfile(f, self.wfile)
        return
    super().send_error(code, message, explain)


if __name__ == "__main__":
  target_dir = os.path.join(os.path.dirname(__file__), "public")

  handler = partial(CustomHandler, directory=target_dir)
  server_address = ("", 8000)
  httpd = HTTPServer(server_address, handler)

  print(f"Serving '{target_dir}' on http://localhost:8000")
  httpd.serve_forever()
