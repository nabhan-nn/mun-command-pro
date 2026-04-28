import os, json, re
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from google import genai
import firebase_admin
from firebase_admin import credentials, db as firebase_db
import cloudinary
import cloudinary.uploader

# Load your .env file
load_dotenv()

# Start Flask
app = Flask(__name__)

# Connect to Gemini
gemini_client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))

# Connect to Firebase
import json
firebase_creds = json.loads(os.getenv('FIREBASE_CREDENTIALS'))
cred = credentials.Certificate(firebase_creds)
firebase_admin.initialize_app(cred, {'databaseURL': os.getenv('FIREBASE_DATABASE_URL')})

# Connect to Cloudinary for file storage
cloudinary.config(
    cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key    = os.getenv('CLOUDINARY_API_KEY'),
    api_secret = os.getenv('CLOUDINARY_API_SECRET')
)

# ─── PAGES ────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/chair')
def chair():
    return render_template('chair.html')

@app.route('/delegate')
def delegate():
    return render_template('delegate.html')

# ─── AI SCORE ─────────────────────────────
@app.route('/api/ai-score', methods=['POST'])
def ai_score():
    data = request.get_json()
    text = data.get('text', '').strip()

    if not text or len(text) < 10:
        return jsonify({'ai_probability': 0})

    try:
        prompt = (
            'You are an AI detection tool. '
            'Return ONLY valid JSON with key ai_probability as integer 0 to 100. '
            'Text: ' + text
        )
        response = gemini_client.models.generate_content(
            model='gemini-1.5-flash',
            contents=prompt
        )
        result = json.loads(response.text)
        return jsonify(result)
    except Exception:
        return jsonify({'ai_probability': heuristic(text)})

def heuristic(text):
    words = ['furthermore','additionally','consequently',
             'it is worth noting','utilize','leverage',
             'facilitate','robust','comprehensive','holistic',
             'in conclusion','it should be noted','moreover']
    score = sum(12 for w in words if re.search(r'\b'+w+r'\b', text.lower()))
    return min(score, 99)

# ─── DELETE FILE FROM CLOUDINARY ──────────
@app.route('/api/delete-file', methods=['POST'])
def delete_file():
    data = request.get_json()
    public_id = data.get('public_id')
    result = cloudinary.uploader.destroy(public_id, resource_type='raw')
    return jsonify(result)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
