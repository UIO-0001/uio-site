# -*- coding: utf-8 -*-
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from datetime import datetime
import requests
import os

app = Flask(__name__)
CORS(app)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

CLIENTS = {
    "uio": {
        "nom": "Assistant UIO",
        "couleur": "#7c5cfc",
        "suggestions": ["Nos services", "Nos tarifs", "Comment ca marche ?"],
        "system_prompt": (
            "Tu es l'assistant IA de UIO Automatisation, une entreprise quebecoise specialisee en chatbots IA et sites web pour les petites entreprises.\n\n"
            "MESSAGE D ACCUEIL : A la toute premiere interaction presente-toi ainsi : "
            "Bonjour ! Je suis l'assistant IA de UIO. Je peux vous aider a decouvrir nos services, obtenir une estimation de prix, ou repondre a vos questions. Par ou voulez-vous commencer ?\n\n"
            "NOS SERVICES ET TARIFS :\n"
            "- Site web personnalise : 100$ a 400$ (setup) + 20$ a 40$/mois. Comprend des mises a jour frequentes et des ajustements selon les demandes du client.\n"
            "- Chatbot IA personnalise : 250$ a 600$ (setup) + 35$ a 60$/mois. Chatbot intelligent integre sur le site du client, disponible 24/7.\n\n"
            "COMPORTEMENT :\n"
            "- Reponds en francais, de facon concise et chaleureuse (2-3 phrases max)\n"
            "- A la fin de chaque reponse, propose toujours une action suivante.\n"
            "- Guide subtilement le client vers une prise de contact ou un devis\n"
            "- Si le client hesite, mets en valeur le rapport qualite-prix et la disponibilite 24/7\n\n"
            "CONTACT : Pour tout devis precis, invite a ecrire a uio.automatisationia@gmail.com ou sur Instagram @uio.automation"
        )
    },
    "demo": {
        "nom": "Assistant Demo",
        "couleur": "#1D9E75",
        "suggestions": ["Nos services", "Nos tarifs", "Comment ca marche ?"],
        "system_prompt": "Tu es un assistant de demonstration pour UIO Automatisation. Montre les capacites du chatbot de facon professionnelle. Reponds en francais."
    }
    # Pour ajouter un client :
    # "restaurant_mario": {
    #     "nom": "Assistant Mario",
    #     "couleur": "#e74c3c",
    #     "suggestions": ["Notre menu", "Nos horaires", "Reserver une table"],
    #     "system_prompt": "Tu es l'assistant du Restaurant Mario..."
    # }
}

@app.route("/")
def home():
    return "UIO Backend actif"

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    messages = data.get("messages", [])
    client_id = data.get("client_id", "uio")
    client = CLIENTS.get(client_id, CLIENTS["uio"])

    if len(messages) > 20:
        return jsonify({
            "choices": [{
                "message": {
                    "content": "Vous avez atteint la limite de cette conversation. Contactez-nous directement pour continuer."
                }
            }]
        })

    now = datetime.now().strftime("%A %d %B %Y, %H:%M")
    system = {
        "role": "system",
        "content": client["system_prompt"] + "\n\nDate et heure actuelle : " + now
    }

    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": "Bearer " + OPENAI_API_KEY,
            "Content-Type": "application/json"
        },
        json={
            "model": "gpt-4o-mini",
            "max_tokens": 300,
            "messages": [system] + messages
        }
    )
    return jsonify(response.json())

@app.route("/chatbot.js")
def chatbot_js():
    client_id = request.args.get("client", "uio")
    client = CLIENTS.get(client_id, CLIENTS["uio"])
    couleur = client["couleur"]
    nom = client["nom"]
    suggestions = client.get("suggestions", ["Nos services", "Nos tarifs", "Comment ca marche ?"])
    backend = request.host_url.rstrip("/")

    sugg_html = ""
    for s in suggestions:
        sugg_html += '<button class=\\"uio-sugg\\" onclick=\\"suggClick(this)\\">' + s + '</button>'

    js = ("""
(function() {
  var CLIENT_ID = '""" + client_id + """';
  var NOM = '""" + nom + """';
  var COULEUR = '""" + couleur + """';
  var BACKEND = '""" + backend + """';
  var history = [];

  var style = document.createElement('style');
  style.textContent = `
    #uio-btn { position:fixed; bottom:24px; right:24px; width:56px; height:56px; border-radius:50%; background:""" + couleur + """; border:none; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,0.2); font-size:24px; z-index:9999; }
    #uio-box { position:fixed; bottom:92px; right:24px; width:340px; height:480px; background:#fff; border-radius:16px; box-shadow:0 8px 40px rgba(0,0,0,0.18); display:none; flex-direction:column; z-index:9999; overflow:hidden; font-family:sans-serif; }
    #uio-head { background:""" + couleur + """; padding:14px 18px; color:#fff; font-weight:600; font-size:15px; display:flex; align-items:center; gap:10px; }
    #uio-online { width:8px; height:8px; border-radius:50%; background:#5DCAA5; }
    #uio-msgs { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
    .uio-bubble { max-width:80%; padding:9px 13px; border-radius:12px; font-size:13px; line-height:1.5; }
    .uio-bot { background:#f1f0f0; color:#111; align-self:flex-start; border-bottom-left-radius:3px; }
    .uio-user { background:""" + couleur + """; color:#fff; align-self:flex-end; border-bottom-right-radius:3px; }
    #uio-suggestions { display:flex; flex-direction:column; gap:6px; margin-top:8px; }
    .uio-sugg { background:transparent; border:1px solid """ + couleur + """; color:""" + couleur + """; border-radius:20px; padding:6px 14px; font-size:12px; cursor:pointer; text-align:left; transition:all .2s; }
    .uio-sugg:hover { background:""" + couleur + """; color:#fff; }
    #uio-input-row { display:flex; gap:8px; padding:10px; border-top:1px solid #eee; }
    #uio-input { flex:1; border:1px solid #ddd; border-radius:8px; padding:8px 12px; font-size:13px; outline:none; }
    #uio-send { background:""" + couleur + """; color:#fff; border:none; border-radius:8px; padding:8px 14px; cursor:pointer; font-size:13px; }
  `;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'uio-btn';
  btn.innerHTML = '&#129302;';
  document.body.appendChild(btn);

  var box = document.createElement('div');
  box.id = 'uio-box';
  box.innerHTML = '<div id="uio-head"><div id="uio-online"></div>' + NOM + '</div><div id="uio-msgs"><div class="uio-bubble uio-bot">Bonjour ! Comment puis-je vous aider ?</div><div id="uio-suggestions">""" + sugg_html + """</div></div><div id="uio-input-row"><input id="uio-input" placeholder="Votre message..."/><button id="uio-send">Envoyer</button></div>';
  document.body.appendChild(box);

  btn.onclick = function() {
    box.style.display = box.style.display === 'flex' ? 'none' : 'flex';
  };

  function suggClick(btn) {
    var text = btn.textContent;
    var sugg = document.getElementById('uio-suggestions');
    if (sugg) sugg.remove();
    document.getElementById('uio-input').value = text;
    sendMsg();
  }

  function addBubble(text, role) {
    var d = document.createElement('div');
    d.className = 'uio-bubble ' + (role === 'user' ? 'uio-user' : 'uio-bot');
    d.textContent = text;
    document.getElementById('uio-msgs').appendChild(d);
    document.getElementById('uio-msgs').scrollTop = 99999;
    return d;
  }

  document.getElementById('uio-send').onclick = sendMsg;
  document.getElementById('uio-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMsg();
  });

  async function sendMsg() {
    var input = document.getElementById('uio-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addBubble(text, 'user');
    history.push({role:'user', content:text});
    var typing = addBubble('...', 'bot');
    try {
      var res = await fetch(BACKEND + '/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({messages: history, client_id: CLIENT_ID})
      });
      var data = await res.json();
      typing.remove();
      var reply = data.choices[0].message.content;
      addBubble(reply, 'bot');
      history.push({role:'assistant', content:reply});
    } catch(e) {
      typing.remove();
      addBubble('Erreur de connexion. Veuillez reessayer.', 'bot');
    }
  }
})();
""")
    return Response(js, mimetype="application/javascript")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
