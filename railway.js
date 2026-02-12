const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Modificar el index.html para railway
const fs = require('fs');
const path = require('path');
const indexPath = path.join(__dirname, 'public', 'index.html');

if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('</body>', `
    <div style="margin: 20px; padding: 20px; border: 1px solid #ccc; border-radius: 5px; background-color: #f8f9fa;">
      <h3>⚠️ OpenClaw requiere más recursos de los que Railway puede ofrecer en su plan gratuito</h3>
      <p>Para usar OpenClaw con todas sus funcionalidades, recomendamos ejecutarlo localmente con Docker:</p>
      <pre style="background-color: #f1f1f1; padding: 10px; border-radius: 5px;">
# Clonar el repositorio
git clone https://github.com/wuweillove/capibara-cloud.git
cd capibara-cloud

# Iniciar con Docker Compose
docker-compose up -d
      </pre>
      <p>Requisitos: Docker y al menos 2GB de RAM disponible.</p>
      <p><a href="https://github.com/wuweillove/capibara-cloud" class="btn btn-primary">Ver en GitHub</a></p>
    </div>
    </body>`);
    fs.writeFileSync(indexPath, html);
}

app.listen(PORT, () => {
  console.log(`Railway proxy running on port ${PORT}`);
});