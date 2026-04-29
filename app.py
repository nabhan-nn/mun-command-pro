import os, json, re
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from google import genai
import firebase_admin
from firebase_admin import credentials, db as firebase_db
import cloudinary
import cloudinary.uploader
from googleapiclient.discovery import build
from google.oauth2 import service_account

load_dotenv()
app = Flask(__name__)

# Gemini
gemini_client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))

# Firebase
firebase_creds = json.loads(os.getenv('FIREBASE_CREDENTIALS'))
cred = credentials.Certificate(firebase_creds)
firebase_admin.initialize_app(cred, {
    'databaseURL': os.getenv('FIREBASE_DATABASE_URL')
})

# Cloudinary
cloudinary.config(
    cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key    = os.getenv('CLOUDINARY_API_KEY'),
    api_secret = os.getenv('CLOUDINARY_API_SECRET')
)

# Google Sheets
SHEET_ID = os.getenv('GOOGLE_SHEET_ID')

def get_sheets_service():
    creds_dict = json.loads(os.getenv('FIREBASE_CREDENTIALS'))
    creds = service_account.Credentials.from_service_account_info(
        creds_dict,
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    return build('sheets', 'v4', credentials=creds)

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

@app.route('/secretariat')
def secretariat():
    return render_template('secretariat.html')

# ─── VERIFY CODE ──────────────────────────
@app.route('/api/verify-code', methods=['POST'])
def verify_code():
    data = request.get_json()
    code = data.get('code', '').strip().upper()

    if not code:
        return jsonify({'valid': False, 'error': 'No code provided'})

    try:
        service = get_sheets_service()
        sheets = service.spreadsheets()

        # Check Chairs tab
        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Chairs!A:C').execute()
        rows = result.get('values', [])
        for row in rows[1:]:  # skip header
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({
                    'valid': True,
                    'role': 'chair',
                    'name': row[1],
                    'committee': row[2],
                    'code': code
                })

        # Check Delegates tab
        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Delegates!A:C').execute()
        rows = result.get('values', [])
        for row in rows[1:]:
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({
                    'valid': True,
                    'role': 'delegate',
                    'country': row[1],
                    'committee': row[2],
                    'code': code
                })

        # Check Secretariat tab
        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Secretariat!A:C').execute()
        rows = result.get('values', [])
        for row in rows[1:]:
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({
                    'valid': True,
                    'role': 'secretariat',
                    'name': row[1],
                    'role_title': row[2],
                    'code': code
                })

        return jsonify({'valid': False, 'error': 'Invalid code'})

    except Exception as e:
        return jsonify({'valid': False, 'error': str(e)})

# ─── GET DELEGATES FOR COMMITTEE ──────────
@app.route('/api/delegates/<committee>', methods=['GET'])
def get_delegates(committee):
    try:
        service = get_sheets_service()
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range='Delegates!A:C'
        ).execute()
        rows = result.get('values', [])
        delegates = [
            {'code': r[0], 'country': r[1], 'committee': r[2]}
            for r in rows[1:]
            if len(r) >= 3 and r[2].strip().lower() == committee.strip().lower()
        ]
        return jsonify({'delegates': delegates})
    except Exception as e:
        return jsonify({'delegates': [], 'error': str(e)})

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