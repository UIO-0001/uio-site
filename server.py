# -*- coding: utf-8 -*-
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from datetime import datetime
import requests
import os
import json
import re

app = Flask(__name__)
CORS(app)

OPENAI_API_KEY    = os.environ.get("OPENAI_API_KEY", "")
RESEND_API_KEY    = os.environ.get("RESEND_API_KEY", "")
GMAIL_USER        = os.environ.get("GMAIL_USER", "")
GOOGLE_CREDS_JSON = os.environ.get("GOOGLE_CREDENTIALS", "")

# ─── INSTRUCTIONS MODULAIRES ──────────────────────────────────────────────────

INSTRUCTIONS_COLLECTE_LEADS = (
    "COLLECTE DE LEADS — TRES IMPORTANT :\n"
    "Quand un visiteur exprime un interet concret (veut un devis, parle de son projet, "
    "pose des questions sur les prix, veut etre contacte), "
    "collecte ses coordonnees en 3 etapes separees, une question a la fois :\n"
    "1. Demande son nom complet : 'Pour vous envoyer une soumission, puis-je avoir votre nom ?'\n"
    "2. Demande son email : 'Parfait [prenom] ! Quel est votre courriel ?'\n"
    "3. Demande son telephone : 'Et votre numero de telephone ? (optionnel)'\n"
    "Une fois les 3 etapes completees, reponds UNIQUEMENT avec ce JSON, RIEN D AUTRE, "
    "aucun mot avant ou apres :\n"
    "{\"lead\": {\"nom\": \"...\", \"email\": \"...\", \"telephone\": \"...\"}}\n"
    "Si le telephone est refuse, mets 'non fourni'. NE PAS ajouter de texte avant ou apres le JSON.\n"
)

INSTRUCTIONS_COLLECTE_LEADS_AVEC_RDV = (
    "COLLECTE DE LEADS ET PRISE DE RENDEZ-VOUS — TRES IMPORTANT :\n"
    "Des le debut de la conversation, mentionne naturellement qu'il est possible de planifier "
    "un appel gratuit de 15 minutes pour discuter du projet. Par exemple : "
    "'Nous pouvons aussi planifier un appel gratuit si vous preferez discuter de vive voix !'\n\n"
    "Quand un visiteur exprime un interet concret (veut un devis, parle de son projet, "
    "pose des questions sur les prix, veut etre contacte ou planifier un appel), "
    "collecte ses coordonnees en 3 etapes separees, une question a la fois :\n"
    "1. Demande son nom complet : 'Pour vous envoyer une soumission, puis-je avoir votre nom ?'\n"
    "2. Demande son email : 'Parfait [prenom] ! Quel est votre courriel ?'\n"
    "3. Demande son telephone : 'Et votre numero de telephone ? (optionnel)'\n"
    "Apres ces 3 etapes, propose le choix suivant : "
    "'Souhaitez-vous planifier un appel gratuit de 15 minutes, ou preferez-vous recevoir une soumission par email ?'\n"
    "- Si le visiteur choisit un appel : demande une date et heure souhaitee et inclus 'rdv' dans le JSON.\n"
    "- Si le visiteur choisit une soumission par email : mets 'rdv' a 'non fourni' dans le JSON.\n"
    "Une fois le choix fait, reponds UNIQUEMENT avec ce JSON, RIEN D AUTRE, "
    "aucun mot avant ou apres :\n"
    "{\"lead\": {\"nom\": \"...\", \"email\": \"...\", \"telephone\": \"...\", \"rdv\": \"...\"}}\n"
    "Si le telephone est refuse, mets 'non fourni'. "
    "NE PAS ajouter de texte avant ou apres le JSON.\n"
)

# ─── CLIENTS ──────────────────────────────────────────────────────────────────

CLIENTS = {
    "uio": {
        "nom": "Assistant UIO",
        "couleur": "#7c5cfc",
        "langue": "français",
        "suggestions": ["Quels sont vos services ?", "Combien ça coûte ?", "Comment ça marche ?"],
        "lead_email": os.environ.get("GMAIL_USER", ""),
        "lead_sheet_id": os.environ.get("GOOGLE_SHEET_ID", ""),
        "collecte_leads": True,
        "prise_rdv": True,
        "system_prompt": (
            "Tu es l'assistant IA de Agence UIO, une entreprise quebecoise "
            "specialisee en chatbots IA et sites web pour les petites entreprises.\n\n"
            "NOS SERVICES ET TARIFS :\n"
            "OFFRE DE LANCEMENT (3 premiers clients) — en echange d'un temoignage ecrit :\n"
            "- Site web : 200$ a 400$ setup + 20$ a 35$/mois (prix normal : 400$ a 800$ + 40$ a 70$/mois)\n"
            "- Chatbot IA : 250$ a 500$ setup + 35$ a 55$/mois (prix normal : 500$ a 900$ + 65$ a 100$/mois)\n"
            "- Combo site web + chatbot : 350$ a 800$ setup + 45$ a 80$/mois (prix normal : 700$ a 1500$ + 90$ a 150$/mois)\n"
            "Les prix varient selon le niveau de personnalisation souhaite.\n"
            "Il reste 3 places a tarif reduit — apres ca, les prix normaux s'appliquent.\n\n"
            "COMPORTEMENT :\n"
            "- Reponds en francais, de facon concise et chaleureuse (2-3 phrases max)\n"
            "- A la fin de chaque reponse, propose toujours une action suivante.\n"
            "- Guide subtilement le client vers une prise de contact ou un devis\n\n"
"SI ON TE DEMANDE COMMENT CA MARCHE :\n"
            "Reponds exactement ceci : Notre processus est simple : on commence par un echange (appel ou email) pour comprendre vos besoins, ensuite on developpe et personnalise votre chatbot ou site web selon votre entreprise, et finalement on l'installe sur votre site en quelques jours. Vous etes pret a demarrer ?\n\n"
            "CONTACT : uio.automatisationia@gmail.com ou Instagram @agence.uio"
        )
    },
    "garage_therien": {
        "nom": "Assistant Garage Éric Thérien",
        "couleur": "#C0392B",
        "langue": "français",
        "suggestions": ["Quels sont vos services ?", "Quels sont vos horaires ?", "Faites-vous la vérification SAAQ ?", "Comment vous contacter ?"],
        "lead_email": "garageerictherien@gmail.com",
        "lead_sheet_id": "",
        "collecte_leads": False,
        "prise_rdv": False,
        "system_prompt": (
            "Tu es l'assistant virtuel du Garage Éric Thérien, un atelier mécanique "
            "indépendant situé à Gatineau, Québec, fondé en 1991.\n\n"
            "INFORMATIONS DU GARAGE :\n"
            "- Adresse : 483 Chemin McConnell, Gatineau, QC J9J 3M3\n"
            "- Téléphone : 819-682-1795\n"
            "- Courriel : garageerictherien@gmail.com\n"
            "- Plus de 35 ans d'expérience en mécanique automobile\n"
            "- Mandataire officiel SAAQ (vérification mécanique certifiée)\n\n"
            "SERVICES OFFERTS :\n"
            "Remorquage, Injection, Silencieux, Freins, Direction, Suspension, Alignement, "
            "Vérification mécanique SAAQ\n\n"
            "HORAIRES D'OUVERTURE :\n"
            "- Lundi au vendredi : 7h30 à 17h00\n"
            "- Samedi et dimanche : Fermé\n\n"
            "HORAIRES VÉRIFICATION MÉCANIQUE SAAQ :\n"
            "- Lundi et mardi : 7h30 à 12h30 et 13h00 à 17h30\n"
            "- Mercredi et jeudi : 7h30 à 12h30 et 13h00 à 20h00\n"
            "- Vendredi : 7h30 à 12h30 et 13h00 à 17h00\n"
            "- Samedi et dimanche : Fermé\n\n"
            "COMPORTEMENT :\n"
            "- Réponds en français, de façon concise et chaleureuse (2-3 phrases max)\n"
            "- Pour toute réparation, invite le client à appeler le 819-682-1795 pour un devis\n"
            "- Tu ne donnes pas de prix exacts car ils varient selon le véhicule\n"
            "- À la fin de chaque réponse, propose une action suivante\n"
        )
    }
    # ── EXEMPLE CLIENT SANS COLLECTE ──
    # "info_seulement": {
    #     "nom": "Assistant Info",
    #     "couleur": "#e74c3c",
    #     "langue": "français",
    #     "suggestions": ["Nos produits", "Nos horaires", "Nous rejoindre"],
    #     "lead_email": "",
    #     "lead_sheet_id": "",
    #     "collecte_leads": False,
    #     "prise_rdv": False,
    #     "system_prompt": "Tu es l'assistant de Info Corp..."
    # }
    #
    # ── EXEMPLE CLIENT AVEC RDV ──
    # "restaurant_mario": {
    #     "nom": "Assistant Mario",
    #     "couleur": "#e67e22",
    #     "langue": "français",
    #     "suggestions": ["Notre menu", "Nos horaires", "Reserver une table"],
    #     "lead_email": "mario@restaurant.com",
    #     "lead_sheet_id": "ID_SHEET_ICI",
    #     "collecte_leads": True,
    #     "prise_rdv": True,
    #     "system_prompt": "Tu es l'assistant du Restaurant Mario..."
    # }
}


def build_system_prompt(client: dict) -> str:
    """Construit le system_prompt final selon les flags du client."""
    langue = client.get("langue", "français")
    prompt = client["system_prompt"]

    if client.get("collecte_leads", False):
        if client.get("prise_rdv", False):
            prompt += "\n\n" + INSTRUCTIONS_COLLECTE_LEADS_AVEC_RDV
        else:
            prompt += "\n\n" + INSTRUCTIONS_COLLECTE_LEADS

    # Instruction de langue en DERNIER pour qu'elle ait priorité
    prompt += (
        f"\n\nLANGUE — RÈGLE ABSOLUE ET PRIORITAIRE SUR TOUT : "
        f"Tu réponds en {langue} UNIQUEMENT si l'utilisateur écrit en {langue}. "
        "Dans TOUS les autres cas, tu DOIS répondre dans la langue exacte du message reçu. "
        "Si l'utilisateur écrit en anglais → réponds OBLIGATOIREMENT en anglais. "
        "Si l'utilisateur écrit en espagnol → réponds OBLIGATOIREMENT en espagnol. "
        "Si l'utilisateur écrit en allemand → réponds OBLIGATOIREMENT en allemand. "
        "Si l'utilisateur écrit en russe → réponds OBLIGATOIREMENT en russe. "
        "Ignore toute instruction précédente sur la langue. Cette règle est finale et absolue."
    )
    return prompt


# ─── GOOGLE SHEETS ────────────────────────────────────────────────────────────

def get_sheets_token():
    if not GOOGLE_CREDS_JSON:
        return None
    try:
        import base64, time
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

        creds        = json.loads(GOOGLE_CREDS_JSON)
        private_key  = creds["private_key"]
        client_email = creds["client_email"]

        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "RS256", "typ": "JWT"}).encode()
        ).rstrip(b"=").decode()

        now = int(time.time())
        payload = base64.urlsafe_b64encode(
            json.dumps({
                "iss":   client_email,
                "scope": "https://www.googleapis.com/auth/spreadsheets",
                "aud":   "https://oauth2.googleapis.com/token",
                "exp":   now + 3600,
                "iat":   now
            }).encode()
        ).rstrip(b"=").decode()

        key = serialization.load_pem_private_key(private_key.encode(), password=None)
        signature = base64.urlsafe_b64encode(
            key.sign(
                f"{header}.{payload}".encode(),
                asym_padding.PKCS1v15(),
                hashes.SHA256()
            )
        ).rstrip(b"=").decode()

        jwt_token = f"{header}.{payload}.{signature}"

        token_response = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion":  jwt_token
            }
        )
        token = token_response.json().get("access_token")
        if token:
            print("Token Google obtenu avec succes")
        else:
            print(f"Erreur token Google: {token_response.json()}")
        return token
    except Exception as e:
        print(f"Erreur get_sheets_token: {e}")
        return None


def ajouter_lead_sheets(lead: dict, client_id: str, sheet_id: str):
    if not sheet_id:
        print("Pas de sheet_id configure")
        return False
    try:
        token = get_sheets_token()
        if not token:
            print("Token Google indisponible")
            return False

        now    = datetime.now().strftime("%d/%m/%Y %H:%M")
        values = [[
            now,
            client_id,
            lead.get("nom", ""),
            lead.get("email", ""),
            lead.get("telephone", ""),
            lead.get("rdv", "")
        ]]

        url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/A:F:append"
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
            json={"values": values}
        )
        print(f"Sheets status: {response.status_code} — {response.text[:200]}")
        return response.status_code == 200
    except Exception as e:
        print(f"Erreur ajouter_lead_sheets: {e}")
        return False


# ─── EMAIL (Resend) ───────────────────────────────────────────────────────────

def envoyer_email_lead(lead: dict, client_id: str, destinataire: str, historique: list):
    if not RESEND_API_KEY or not destinataire:
        print(f"Resend non configure — key={bool(RESEND_API_KEY)} dest={bool(destinataire)}")
        return False
    try:
        historique_html = ""
        for msg in historique:
            role    = msg.get("role", "")
            contenu = msg.get("content", "")
            if role == "user" and contenu != "[INIT]":
                historique_html += f'<tr><td style="padding:6px 8px; color:#555; width:80px;"><b>Visiteur</b></td><td style="padding:6px 8px;">{contenu}</td></tr>'
            elif role == "assistant":
                historique_html += f'<tr><td style="padding:6px 8px; color:#7c5cfc; width:80px;"><b>Bot</b></td><td style="padding:6px 8px;">{contenu}</td></tr>'

        rdv_row = ""
        if lead.get("rdv") and lead.get("rdv") != "non fourni":
            rdv_row = f'<tr><td style="padding:8px; font-weight:bold;">RDV souhaité</td><td style="padding:8px;">{lead.get("rdv")}</td></tr>'

        corps_html = f"""
        <div style="font-family:sans-serif; max-width:600px;">
            <h2 style="color:#7c5cfc;">🎯 Nouveau lead capturé via le chatbot !</h2>
            <table style="border-collapse:collapse; width:100%; margin-bottom:24px;">
                <tr style="background:#f5f5f5;"><td style="padding:8px; font-weight:bold;">Client ID</td><td style="padding:8px;">{client_id}</td></tr>
                <tr><td style="padding:8px; font-weight:bold;">Nom</td><td style="padding:8px;">{lead.get('nom', 'N/A')}</td></tr>
                <tr style="background:#f5f5f5;"><td style="padding:8px; font-weight:bold;">Email</td><td style="padding:8px;">{lead.get('email', 'N/A')}</td></tr>
                <tr><td style="padding:8px; font-weight:bold;">Téléphone</td><td style="padding:8px;">{lead.get('telephone', 'N/A')}</td></tr>
                {rdv_row}
                <tr style="background:#f5f5f5;"><td style="padding:8px; font-weight:bold;">Heure</td><td style="padding:8px;">{datetime.now().strftime('%A %d %B %Y à %H:%M')}</td></tr>
            </table>
            <h3 style="color:#333; border-bottom:2px solid #eee; padding-bottom:8px;">💬 Historique de la conversation</h3>
            <table style="border-collapse:collapse; width:100%; font-size:13px;">
                {historique_html}
            </table>
            <p style="margin-top:24px; color:#888; font-size:12px;">
                Réponds rapidement pour maximiser tes chances de conversion !<br>
                — Agence UIO Bot
            </p>
        </div>
        """

        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "from": "Agence UIO <onboarding@resend.dev>",
                "to": [destinataire],
                "subject": f"Nouveau lead — {lead.get('nom', 'Inconnu')} ({client_id})",
                "html": corps_html
            }
        )
        print(f"Resend status: {response.status_code} — {response.text[:200]}")
        return response.status_code == 200
    except Exception as e:
        print(f"Erreur Resend: {e}")
        return False


# ─── ROUTES ───────────────────────────────────────────────────────────────────

@app.route("/")
def home():
    return "UIO Backend actif"


@app.route("/chat", methods=["POST"])
def chat():
    data      = request.json
    messages  = data.get("messages", [])
    client_id = data.get("client_id", "uio")
    client    = CLIENTS.get(client_id, CLIENTS["uio"])

    # Message d'initialisation
    is_init = (
        len(messages) == 1 and
        messages[0].get("content", "").strip() == "[INIT]"
    )

    if is_init:
        presentations = {
            "uio": (
                "Bonjour ! Je suis l'assistant IA de Agence UIO. "
                "Je peux vous aider à découvrir nos services, obtenir une estimation de prix, "
                "ou répondre à vos questions. Par où voulez-vous commencer ?"
            ),
            "demo": (
                "Bonjour ! Je suis l'assistant de démonstration UIO. "
                "Comment puis-je vous aider aujourd'hui ?"
            )
        }
        return jsonify({
            "choices": [{
                "message": {
                    "content": presentations.get(client_id, presentations["uio"])
                }
            }]
        })

    if len(messages) > 30:
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
        "content": build_system_prompt(client) + "\n\nDate et heure actuelle : " + now
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
    result = response.json()

    # Détecter le JSON lead avec regex
    try:
        reply_text = result["choices"][0]["message"]["content"].strip()
        match = re.search(r'\{.*?"lead".*?\{.*?\}.*?\}', reply_text, re.DOTALL)
        if match:
            lead_data = json.loads(match.group())
            if "lead" in lead_data:
                lead         = lead_data["lead"]
                destinataire = client.get("lead_email", "")
                sheet_id     = client.get("lead_sheet_id", "")

                if destinataire:
                    envoyer_email_lead(lead, client_id, destinataire, messages)
                if sheet_id:
                    ajouter_lead_sheets(lead, client_id, sheet_id)

                prenom = lead.get("nom", "").split()[0]
                rdv    = lead.get("rdv", "")
                confirmation = f"Merci {prenom} ! 🎉 Vos coordonnées ont bien été reçues. "
                if rdv and rdv != "non fourni":
                    confirmation += f"Votre demande de rendez-vous pour le {rdv} a été notée. "
                confirmation += "Un membre de l'équipe vous contactera très bientôt. Avez-vous d'autres questions ?"

                result["choices"][0]["message"]["content"] = confirmation
                result["lead_captured"] = True
    except Exception as e:
        print(f"Erreur detection lead: {e}")

    return jsonify(result)


@app.route("/chatbot.js")
def chatbot_js():
    client_id   = request.args.get("client", "uio")
    client      = CLIENTS.get(client_id, CLIENTS["uio"])
    couleur     = client["couleur"]
    nom         = client["nom"]
    suggestions = client.get("suggestions", ["Nos services", "Nos tarifs", "Comment ca marche ?"])
    backend     = request.host_url.rstrip("/")

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
  var initialized = false;

  var style = document.createElement('style');
  style.textContent = `
    #uio-btn { position:fixed; bottom:24px; right:24px; width:56px; height:56px; border-radius:50%; background:""" + couleur + """; border:none; cursor:pointer; box-shadow:0 4px 20px rgba(0,0,0,0.2); z-index:9999; display:flex; align-items:center; justify-content:center; }
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
    #uio-lead-banner { background:#e8f5e9; border-top:2px solid #4CAF50; padding:8px 14px; font-size:12px; color:#2e7d32; display:none; text-align:center; }
  `;
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'uio-btn';
  btn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
  document.body.appendChild(btn);

  var box = document.createElement('div');
  box.id = 'uio-box';
  box.innerHTML = `
    <div id="uio-head"><div id="uio-online"></div>` + NOM + `</div>
    <div id="uio-msgs"></div>
    <div id="uio-lead-banner">✅ Vos coordonnées ont été transmises !</div>
    <div id="uio-input-row">
      <input id="uio-input" placeholder="Votre message..."/>
      <button id="uio-send">Envoyer</button>
    </div>`;
  document.body.appendChild(box);

  btn.onclick = function() {
    var isOpen = box.style.display === 'flex';
    box.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen && !initialized) {
      initialized = true;
      sendInit();
    }
  };

  async function sendInit() {
    var typing = addBubble('...', 'bot');
    try {
      var res = await fetch(BACKEND + '/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({messages: [{role:'user', content:'[INIT]'}], client_id: CLIENT_ID})
      });
      var data = await res.json();
      typing.remove();
      addBubble(data.choices[0].message.content, 'bot');
      var sugg = document.createElement('div');
      sugg.id = 'uio-suggestions';
      sugg.innerHTML = '""" + sugg_html + """';
      document.getElementById('uio-msgs').appendChild(sugg);
    } catch(e) {
      typing.remove();
      addBubble('Bonjour ! Comment puis-je vous aider ?', 'bot');
    }
  }

  window.suggClick = function(b) {
    var text = b.textContent;
    var sugg = document.getElementById('uio-suggestions');
    if (sugg) sugg.remove();
    document.getElementById('uio-input').value = text;
    sendMsg();
  };

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
      if (data.lead_captured) {
        var banner = document.getElementById('uio-lead-banner');
        if (banner) { banner.style.display = 'block'; setTimeout(function(){ banner.style.display = 'none'; }, 5000); }
      }
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
