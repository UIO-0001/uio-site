from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os

app = Flask(__name__)
CORS(app)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    messages = data.get("messages", [])

    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": "Bearer " + OPENAI_API_KEY,
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-4o",
            "max_tokens": 300,
            "messages": messages
        }
    )

    return jsonify(response.json())

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)