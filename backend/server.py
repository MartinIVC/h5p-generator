from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # Esto es vital para que Electron no bloquee la conexión

@app.route('/api/saludo', methods=['GET'])
def obtener_saludo():
    return jsonify({"mensaje": "¡El servidor Python está conectado!"})

if __name__ == '__main__':
    app.run(port=5000, debug=True)