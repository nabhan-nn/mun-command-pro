import os
import json
import re
import math
from flask import Flask, request, jsonify, render_template, send_file
from dotenv import load_dotenv
import psycopg2
from psycopg2.extras import RealDictCursor
import cloudinary
import cloudinary.uploader
from googleapiclient.discovery import build
from google.oauth2 import service_account
import io
import requests as http_requests

load_dotenv()
app = Flask(__name__)

def get_db():
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute('''
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            committee TEXT NOT NULL,
            chair_name TEXT,
            is_open BOOLEAN DEFAULT TRUE,
            current_speaker TEXT,
            timer_value INTEGER DEFAULT 90,
            created_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS speakers (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            country TEXT NOT NULL,
            added_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS delegates (
            code TEXT PRIMARY KEY,
            country TEXT NOT NULL,
            committee TEXT NOT NULL,
            room_id TEXT,
            joined_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS chits (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            from_country TEXT NOT NULL,
            to_country TEXT NOT NULL,
            text TEXT NOT NULL,
            ai_score INTEGER DEFAULT 0,
            is_marked BOOLEAN DEFAULT FALSE,
            is_amendment BOOLEAN DEFAULT FALSE,
            sent_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS motions (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            country TEXT NOT NULL,
            type TEXT NOT NULL,
            details TEXT,
            submitted_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            country TEXT NOT NULL,
            type TEXT NOT NULL,
            file_name TEXT,
            public_id TEXT,
            download_url TEXT,
            ai_score INTEGER DEFAULT 0,
            uploaded_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS amendments (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            country TEXT NOT NULL,
            resolution TEXT,
            clause TEXT,
            type TEXT,
            text TEXT,
            status TEXT DEFAULT 'pending',
            submitted_at BIGINT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS points (
            id SERIAL PRIMARY KEY,
            room_id TEXT NOT NULL,
            country TEXT NOT NULL,
            type TEXT NOT NULL,
            raised_at BIGINT
        )
    ''')

    conn.commit()
    cur.close()
    conn.close()

init_db()

cloudinary.config(
    cloud_name=os.getenv('CLOUDINARY_CLOUD_NAME'),
    api_key=os.getenv('CLOUDINARY_API_KEY'),
    api_secret=os.getenv('CLOUDINARY_API_SECRET')
)

SHEET_ID = os.getenv('GOOGLE_SHEET_ID')

def get_sheets_service():
    creds_info = json.loads(os.getenv('GOOGLE_CREDENTIALS'))
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )
    return build('sheets', 'v4', credentials=creds)

def calculate_ai_score(text):
    if not text or len(text) < 20:
        return 0

    score = 0
    text_lower = text.lower()
    words = text.split()
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]

    ai_phrases = [
        'furthermore', 'additionally', 'consequently', 'subsequently',
        'it is worth noting', 'it should be noted', 'in conclusion',
        'to summarize', 'in summary', 'as previously mentioned',
        'utilize', 'leverage', 'facilitate', 'endeavour', 'endeavor',
        'robust', 'comprehensive', 'holistic', 'synergy', 'paradigm',
        'moreover', 'nevertheless', 'notwithstanding', 'therefore',
        'thus', 'hence', 'in light of', 'with regard to',
        'it is important to note', 'one must consider',
        'delve', 'multifaceted', 'nuanced', 'intricate'
    ]

    phrase_hits = sum(1 for phrase in ai_phrases
                      if re.search(r'\b' + re.escape(phrase) + r'\b', text_lower))
    score += min(phrase_hits * 8, 40)

    if len(sentences) >= 3:
        lengths = [len(s.split()) for s in sentences]
        avg = sum(lengths) / len(lengths)
        variance = sum((l - avg) ** 2 for l in lengths) / len(lengths)
        if variance < 10:
            score += 20
        elif variance < 25:
            score += 10

    contractions = ["don't", "can't", "won't", "isn't", "aren't",
                    "I'm", "it's", "that's", "there's", "we're"]
    has_contractions = any(c.lower() in text_lower for c in contractions)
    if not has_contractions and len(words) > 30:
        score += 15

    has_punctuation_errors = bool(re.search(r'[a-z][A-Z]|  +', text))
    if not has_punctuation_errors and len(words) > 20:
        score += 10

    if sentences:
        avg_length = sum(len(s.split()) for s in sentences) / len(sentences)
        if avg_length > 25:
            score += 15
        elif avg_length > 18:
            score += 8

    return min(score, 99)

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

# ─── AUTH ─────────────────────────────────
@app.route('/api/verify-code', methods=['POST'])
def verify_code():
    data = request.get_json()
    code = data.get('code', '').strip().upper()

    if not code:
        return jsonify({'valid': False, 'error': 'No code entered'})

    try:
        service = get_sheets_service()
        sheets = service.spreadsheets()

        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Chairs!A:C').execute()
        for row in result.get('values', [])[1:]:
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({'valid': True, 'role': 'chair',
                                'name': row[1], 'committee': row[2], 'code': code})

        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Delegates!A:C').execute()
        for row in result.get('values', [])[1:]:
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({'valid': True, 'role': 'delegate',
                                'country': row[1], 'committee': row[2], 'code': code})

        result = sheets.values().get(spreadsheetId=SHEET_ID, range='Secretariat!A:C').execute()
        for row in result.get('values', [])[1:]:
            if len(row) >= 3 and row[0].strip().upper() == code:
                return jsonify({'valid': True, 'role': 'secretariat',
                                'name': row[1], 'role_title': row[2], 'code': code})

        return jsonify({'valid': False, 'error': 'Invalid code'})

    except Exception as e:
        return jsonify({'valid': False, 'error': str(e)})

# ─── ROOM ─────────────────────────────────
@app.route('/api/room/create', methods=['POST'])
def create_room():
    data = request.get_json()
    committee = data.get('committee')
    chair_name = data.get('chair_name')
    room_id = committee.replace(' ', '-').upper()

    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT id FROM rooms WHERE id = %s', (room_id,))
    existing = cur.fetchone()

    if not existing:
        cur.execute('''
            INSERT INTO rooms (id, committee, chair_name, is_open, current_speaker, timer_value, created_at)
            VALUES (%s, %s, %s, TRUE, NULL, 90, %s)
        ''', (room_id, committee, chair_name, int(__import__('time').time() * 1000)))
        conn.commit()

    cur.close()
    conn.close()
    return jsonify({'room_id': room_id})

@app.route('/api/room/toggle', methods=['POST'])
def toggle_room():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE rooms SET is_open = %s WHERE id = %s',
                (data.get('is_open'), data.get('room_id')))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/room/<room_id>', methods=['GET'])
def get_room(room_id):
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()
    cur.close()
    conn.close()
    if not room:
        return jsonify({'error': 'Room not found'}), 404
    return jsonify(dict(room))

@app.route('/api/room/set-speaker', methods=['POST'])
def set_speaker():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE rooms SET current_speaker = %s WHERE id = %s',
                (data.get('speaker'), data.get('room_id')))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/room/set-timer', methods=['POST'])
def set_timer():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE rooms SET timer_value = %s WHERE id = %s',
                (data.get('timer'), data.get('room_id')))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── POLL ─────────────────────────────────
@app.route('/api/poll/<room_id>', methods=['GET'])
def poll(room_id):
    since = request.args.get('since', 0, type=int)

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute('SELECT * FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()

    cur.execute('''
        SELECT * FROM chits
        WHERE room_id = %s AND sent_at > %s
        ORDER BY sent_at ASC
    ''', (room_id, since))
    chits = [dict(c) for c in cur.fetchall()]

    cur.execute('SELECT * FROM speakers WHERE room_id = %s ORDER BY added_at ASC', (room_id,))
    speakers = [dict(s) for s in cur.fetchall()]

    cur.execute('SELECT * FROM motions WHERE room_id = %s ORDER BY submitted_at ASC', (room_id,))
    motions = [dict(m) for m in cur.fetchall()]

    cur.execute('SELECT * FROM amendments WHERE room_id = %s ORDER BY submitted_at ASC', (room_id,))
    amendments = [dict(a) for a in cur.fetchall()]

    cur.execute('SELECT * FROM documents WHERE room_id = %s ORDER BY uploaded_at ASC', (room_id,))
    documents = [dict(d) for d in cur.fetchall()]

    cur.execute('SELECT * FROM delegates WHERE room_id = %s', (room_id,))
    delegates = [dict(d) for d in cur.fetchall()]

    cur.execute('SELECT * FROM points WHERE room_id = %s ORDER BY raised_at ASC', (room_id,))
    points = [dict(p) for p in cur.fetchall()]

    cur.close()
    conn.close()

    return jsonify({
        'room': dict(room) if room else None,
        'chits': chits,
        'speakers': speakers,
        'motions': motions,
        'amendments': amendments,
        'documents': documents,
        'delegates': delegates,
        'points': points,
        'timestamp': int(__import__('time').time() * 1000)
    })

# ─── DELEGATES ────────────────────────────
@app.route('/api/delegate/register', methods=['POST'])
def register_delegate():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT code FROM delegates WHERE code = %s', (data.get('code'),))
    existing = cur.fetchone()

    if not existing:
        cur.execute('''
            INSERT INTO delegates (code, country, committee, room_id, joined_at)
            VALUES (%s, %s, %s, %s, %s)
        ''', (data.get('code'), data.get('country'), data.get('committee'),
              data.get('room_id'), int(__import__('time').time() * 1000)))
        conn.commit()

    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/delegates/<committee>', methods=['GET'])
def get_delegates_for_committee(committee):
    try:
        service = get_sheets_service()
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID, range='Delegates!A:C').execute()
        rows = result.get('values', [])
        delegates = [
            {'code': r[0], 'country': r[1], 'committee': r[2]}
            for r in rows[1:]
            if len(r) >= 3 and r[2].strip().lower() == committee.strip().lower()
        ]
        return jsonify({'delegates': delegates})
    except Exception as e:
        return jsonify({'delegates': [], 'error': str(e)})

# ─── SPEAKERS ─────────────────────────────
@app.route('/api/speaker/add', methods=['POST'])
def add_speaker():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO speakers (room_id, country, added_at)
        VALUES (%s, %s, %s)
    ''', (data.get('room_id'), data.get('country'),
          int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/speaker/remove', methods=['POST'])
def remove_speaker():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM speakers WHERE id = %s', (data.get('speaker_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── CHITS ────────────────────────────────
@app.route('/api/chit/send', methods=['POST'])
def send_chit():
    data = request.get_json()
    room_id = data.get('room_id')

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT is_open FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()

    if not room or not room['is_open']:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'closed': True})

    text = data.get('text', '').strip()
    ai_score = calculate_ai_score(text)

    cur.execute('''
        INSERT INTO chits (room_id, from_country, to_country, text, ai_score, is_marked, is_amendment, sent_at)
        VALUES (%s, %s, %s, %s, %s, FALSE, FALSE, %s)
    ''', (room_id, data.get('from_country'), data.get('to_country'),
          text, ai_score, int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'ai_score': ai_score})

@app.route('/api/chit/mark', methods=['POST'])
def mark_chit():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE chits SET is_marked = NOT is_marked WHERE id = %s', (data.get('chit_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/chit/delete-marked', methods=['POST'])
def delete_marked_chits():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM chits WHERE room_id = %s AND is_marked = TRUE', (data.get('room_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── MOTIONS ──────────────────────────────
@app.route('/api/motion/submit', methods=['POST'])
def submit_motion():
    data = request.get_json()
    room_id = data.get('room_id')

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT is_open FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()

    if not room or not room['is_open']:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'closed': True})

    cur.execute('''
        INSERT INTO motions (room_id, country, type, details, submitted_at)
        VALUES (%s, %s, %s, %s, %s)
    ''', (room_id, data.get('country'), data.get('type'),
          data.get('details'), int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/motion/delete', methods=['POST'])
def delete_motion():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM motions WHERE id = %s', (data.get('motion_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── AMENDMENTS ───────────────────────────
@app.route('/api/amendment/submit', methods=['POST'])
def submit_amendment():
    data = request.get_json()
    room_id = data.get('room_id')

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT is_open FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()

    if not room or not room['is_open']:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'closed': True})

    cur.execute('''
        INSERT INTO amendments (room_id, country, resolution, clause, type, text, status, submitted_at)
        VALUES (%s, %s, %s, %s, %s, %s, 'pending', %s)
    ''', (room_id, data.get('country'), data.get('resolution'),
          data.get('clause'), data.get('type'), data.get('text'),
          int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/amendment/resolve', methods=['POST'])
def resolve_amendment():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE amendments SET status = %s WHERE id = %s',
                (data.get('status'), data.get('amendment_id')))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── POINTS ───────────────────────────────
@app.route('/api/point/raise', methods=['POST'])
def raise_point():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO points (room_id, country, type, raised_at)
        VALUES (%s, %s, %s, %s)
    ''', (data.get('room_id'), data.get('country'),
          data.get('type'), int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/point/dismiss', methods=['POST'])
def dismiss_point():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM points WHERE id = %s', (data.get('point_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

# ─── DOCUMENTS ────────────────────────────
@app.route('/api/document/upload', methods=['POST'])
def upload_document():
    data = request.get_json()
    room_id = data.get('room_id')

    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT is_open FROM rooms WHERE id = %s', (room_id,))
    room = cur.fetchone()

    if not room or not room['is_open']:
        cur.close()
        conn.close()
        return jsonify({'success': False, 'closed': True})

    ai_score = calculate_ai_score(data.get('text_sample', ''))

    cur.execute('''
        INSERT INTO documents (room_id, country, type, file_name, public_id, download_url, ai_score, uploaded_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    ''', (room_id, data.get('country'), data.get('doc_type'),
          data.get('file_name'), data.get('public_id'),
          data.get('download_url'), ai_score,
          int(__import__('time').time() * 1000)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True, 'ai_score': ai_score})

@app.route('/api/document/download', methods=['POST'])
def download_document():
    data = request.get_json()
    try:
        response = http_requests.get(data.get('url'), timeout=30)
        if response.status_code != 200:
            return jsonify({'error': 'File not found'}), 404

        file_data = io.BytesIO(response.content)
        file_data.seek(0)

        cloudinary.uploader.destroy(data.get('public_id'), resource_type='raw')

        conn = get_db()
        cur = conn.cursor()
        cur.execute('DELETE FROM documents WHERE id = %s', (data.get('doc_id'),))
        conn.commit()
        cur.close()
        conn.close()

        return send_file(file_data, as_attachment=True,
                         download_name=data.get('filename'),
                         mimetype='application/pdf')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ─── SECRETARIAT ──────────────────────────
@app.route('/api/secretariat/all-rooms', methods=['GET'])
def all_rooms():
    conn = get_db()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute('SELECT * FROM rooms ORDER BY created_at ASC')
    rooms = [dict(r) for r in cur.fetchall()]

    result = []
    for room in rooms:
        cur.execute('SELECT COUNT(*) as count FROM chits WHERE room_id = %s', (room['id'],))
        chit_count = cur.fetchone()['count']
        cur.execute('SELECT COUNT(*) as count FROM chits WHERE room_id = %s AND is_marked = TRUE', (room['id'],))
        marked_count = cur.fetchone()['count']
        cur.execute('SELECT COUNT(*) as count FROM delegates WHERE room_id = %s', (room['id'],))
        delegate_count = cur.fetchone()['count']
        result.append({**room, 'chit_count': chit_count,
                        'marked_count': marked_count, 'delegate_count': delegate_count})

    cur.close()
    conn.close()
    return jsonify(result)

@app.route('/api/secretariat/delete-marked', methods=['POST'])
def secretariat_delete_marked():
    data = request.get_json()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM chits WHERE room_id = %s AND is_marked = TRUE', (data.get('room_id'),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/secretariat/conference-over', methods=['POST'])
def conference_over():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM chits')
    cur.execute('DELETE FROM motions')
    cur.execute('DELETE FROM amendments')
    cur.execute('DELETE FROM documents')
    cur.execute('DELETE FROM points')
    cur.execute('DELETE FROM speakers')
    cur.execute('DELETE FROM delegates')
    cur.execute('DELETE FROM rooms')
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'success': True})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)