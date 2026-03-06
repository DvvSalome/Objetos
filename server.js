const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// Cargar variables de entorno desde .env si existe
// ============================================
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    envFile.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const [key, ...rest] = trimmed.split('=');
        const value = rest.join('=');
        if (key && value && !(key in process.env)) {
            process.env[key] = value;
        }
    });
}

function requireEnv(name) {
    if (!process.env[name]) {
        throw new Error(`La variable de entorno ${name} es obligatoria`);
    }
    return process.env[name];
}

// ============================================
// Configuración de APIs
// ============================================
const GEMINI_API_KEY = requireEnv('GEMINI_API_KEY');
const MESHY_API_KEY = requireEnv('MESHY_API_KEY');
const MESHY_BASE_URL = 'https://api.meshy.ai/openapi/v1';

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');

const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'avatars';
const SUPABASE_FOLDER = process.env.SUPABASE_FOLDER || 'pruebasObjetos';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// ============================================
// Gemini: Generar imagen a partir de prompt
// ============================================
app.post('/api/gemini/generate', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'prompt es requerido' });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${GEMINI_API_KEY}`;
        const requestBody = {
            instances: [{ prompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio: '1:1',
                outputOptions: { mimeType: 'image/jpeg' },
            },
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Gemini] Error generando imagen:', data);
            return res.status(response.status).json({
                error: data.error?.message || 'Error en la solicitud a Gemini',
                details: data,
            });
        }

        res.json(data);

    } catch (error) {
        console.error('[Gemini] Error inesperado:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Supabase: Subir imagen generada
// ============================================
app.post('/api/supabase/upload-image', async (req, res) => {
    try {
        const { image_base64, object_name } = req.body;

        if (!image_base64) {
            return res.status(400).json({ error: 'image_base64 es requerido' });
        }

        // Extraer datos base64
        const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Determinar extensión
        const mimeMatch = image_base64.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext = mimeType.split('/')[1] === 'png' ? 'png' : 'jpg';

        // Nombre único para el archivo
        const timestamp = Date.now();
        const safeName = (object_name || 'objeto').replace(/[^a-zA-Z0-9áéíóúñ]/g, '_').toLowerCase();
        const fileName = `${SUPABASE_FOLDER}/${safeName}_${timestamp}.${ext}`;

        console.log(`[Supabase] Subiendo imagen: ${fileName}`);

        const { data, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .upload(fileName, imageBuffer, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) {
            console.error('[Supabase] Error subiendo imagen:', error);
            return res.status(500).json({ error: error.message });
        }

        // Obtener URL pública
        const { data: publicData } = supabase.storage
            .from(SUPABASE_BUCKET)
            .getPublicUrl(fileName);

        const publicUrl = publicData.publicUrl;
        console.log(`[Supabase] Imagen subida: ${publicUrl}`);

        res.json({
            path: data.path,
            publicUrl: publicUrl,
            fileName: fileName,
        });

    } catch (error) {
        console.error('[Supabase] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Supabase: Subir modelo 3D (GLB/FBX/OBJ)
// ============================================
app.post('/api/supabase/upload-model', async (req, res) => {
    try {
        const { model_url, object_name, format } = req.body;

        if (!model_url) {
            return res.status(400).json({ error: 'model_url es requerido' });
        }

        // Descargar el modelo desde Meshy
        console.log(`[Supabase] Descargando modelo ${format} desde Meshy...`);
        const modelResponse = await fetch(model_url);
        if (!modelResponse.ok) {
            throw new Error(`Error descargando modelo: ${modelResponse.status}`);
        }
        const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());

        // Nombre para el archivo 3D
        const timestamp = Date.now();
        const safeName = (object_name || 'modelo').replace(/[^a-zA-Z0-9áéíóúñ]/g, '_').toLowerCase();
        const ext = format || 'glb';
        const fileName = `${SUPABASE_FOLDER}/${safeName}_${timestamp}.${ext}`;

        // Mapear extensión a MIME type
        const mimeTypes = {
            glb: 'model/gltf-binary',
            fbx: 'application/octet-stream',
            obj: 'text/plain',
        };

        console.log(`[Supabase] Subiendo modelo 3D: ${fileName}`);

        const { data, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .upload(fileName, modelBuffer, {
                contentType: mimeTypes[ext] || 'application/octet-stream',
                upsert: false,
            });

        if (error) {
            console.error('[Supabase] Error subiendo modelo:', error);
            return res.status(500).json({ error: error.message });
        }

        const { data: publicData } = supabase.storage
            .from(SUPABASE_BUCKET)
            .getPublicUrl(fileName);

        console.log(`[Supabase] Modelo subido: ${publicData.publicUrl}`);

        res.json({
            path: data.path,
            publicUrl: publicData.publicUrl,
            fileName: fileName,
        });

    } catch (error) {
        console.error('[Supabase] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Supabase: Listar objetos guardados
// ============================================
app.get('/api/supabase/list-objects', async (req, res) => {
    try {
        const { data, error } = await supabase.storage
            .from(SUPABASE_BUCKET)
            .list(SUPABASE_FOLDER, {
                limit: 100,
                sortBy: { column: 'created_at', order: 'desc' },
            });

        if (error) {
            console.error('[Supabase] Error listando:', error);
            return res.status(500).json({ error: error.message });
        }

        // Agregar URLs públicas
        const files = data.map(file => {
            const { data: publicData } = supabase.storage
                .from(SUPABASE_BUCKET)
                .getPublicUrl(`${SUPABASE_FOLDER}/${file.name}`);
            return {
                ...file,
                publicUrl: publicData.publicUrl,
            };
        });

        res.json(files);

    } catch (error) {
        console.error('[Supabase] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Meshy API: Crear tarea Image-to-3D
// Ahora usa image_url (Supabase público) en vez de multipart base64
// ============================================
app.post('/api/meshy/image-to-3d', async (req, res) => {
    try {
        const { image_url, image_base64, model_type, object_name } = req.body;

        let resolvedImageUrl = image_url;

        if (!resolvedImageUrl) {
            if (!image_base64) {
                return res.status(400).json({ error: 'image_url o image_base64 es requerido' });
            }

            // Asegurar que sea un data URI válido para Meshy
            if (!image_base64.startsWith('data:image')) {
                // Si solo viene el base64 puro, agregar encabezado
                resolvedImageUrl = `data:image/jpeg;base64,${image_base64}`;
            } else {
                resolvedImageUrl = image_base64;
            }
        }

        const body = { image_url: resolvedImageUrl };

        if (model_type === 'lowpoly') {
            body.model_type = 'lowpoly';
            body.should_texture = true;
            body.enable_pbr = true;
        } else {
            body.model_type = 'standard';
            body.ai_model = 'meshy-6';
            body.should_remesh = true;
            body.topology = 'quad';
            body.target_polycount = 3000;
            body.should_texture = true;
            body.enable_pbr = true;
            body.symmetry_mode = 'auto';
        }

        console.log(`[Meshy] Creando tarea image-to-3d (${model_type}) via JSON para: ${object_name || 'objeto'}`);

        const response = await fetch(`${MESHY_BASE_URL}/image-to-3d`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MESHY_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Meshy] Error creando tarea:', data);
            return res.status(response.status).json({
                error: data.message || data.error || 'Error en Meshy API',
                details: data,
            });
        }

        console.log('[Meshy] Tarea creada:', data);
        res.json(data);

    } catch (error) {
        console.error('[Meshy] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Meshy API: Consultar estado de tarea
// ============================================
app.get('/api/meshy/task/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;

        const response = await fetch(`${MESHY_BASE_URL}/image-to-3d/${taskId}`, {
            headers: {
                'Authorization': `Bearer ${MESHY_API_KEY}`,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[Meshy] Error consultando tarea:', data);
            return res.status(response.status).json({
                error: data.message || 'Error consultando tarea',
                details: data,
            });
        }

        res.json(data);

    } catch (error) {
        console.error('[Meshy] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Proxy para descargar modelo 3D (evitar CORS)
// ============================================
app.get('/api/meshy/download', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).json({ error: 'url es requerido' });
        }

        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).json({ error: 'Error descargando modelo' });
        }

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        res.setHeader('Access-Control-Allow-Origin', '*');

        response.body.pipe(res);

    } catch (error) {
        console.error('[Meshy] Error descargando:', error.message);
        res.status(500).json({ error: error.message });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
        console.log(`📦 Meshy API configurada`);
        console.log(`☁️  Supabase Storage: ${SUPABASE_BUCKET}/${SUPABASE_FOLDER}`);
        console.log(`🎨 Abre http://localhost:${PORT} en tu navegador\n`);
    });
}

module.exports = app;
