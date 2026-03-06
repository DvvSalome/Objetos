# Generador de Objetos 3D (Gather Style)

Aplicación web + servidor Express que genera referencias 2D con Gemini y las convierte a modelos 3D usando Meshy. Los archivos finales se guardan en Supabase Storage y pueden visualizarse desde el frontend.

## Requisitos

- Node.js 18+
- Cuenta y credenciales para:
  - [Google AI Studio (Gemini)](https://aistudio.google.com/)
  - [Meshy](https://www.meshy.ai/)
  - [Supabase](https://supabase.com/) con un bucket público

## Configuración

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Duplica el archivo `.env.example` y renómbralo a `.env`.
3. Completa las variables:
   ```bash
   GEMINI_API_KEY=tu_api_key
   MESHY_API_KEY=tu_api_key
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_ANON_KEY=tu_anon_key
   SUPABASE_BUCKET=avatars
   SUPABASE_FOLDER=pruebasObjetos
   PORT=3000
   ```
4. **No compartas ni subas el archivo `.env` al repositorio.**

## Ejecución

```bash
npm run dev
```

El servidor expone:
- `POST /api/gemini/generate` para generar imágenes con Gemini.
- `POST /api/meshy/image-to-3d` y `GET /api/meshy/task/:taskId` para manejar tareas de Meshy.
- Endpoints de Supabase para subir/listar imágenes y modelos.

El frontend está en `index.html` y consume el backend mediante `window.location.origin`, por lo que basta con abrir `http://localhost:PORT` tras iniciar el servidor.

## Seguridad

- `.gitignore` ya excluye `node_modules/` y cualquier archivo `.env*`.
- Nunca hardcodees claves dentro del frontend; siempre usa los endpoints del backend.
- Rotar claves inmediatamente si se exponen accidentalmente.

# Objetos
