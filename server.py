import flask

from flask import app, jsonify

app = app.App()

@app.route("/")
def home():
    return "poo"