import dotenv from 'dotenv'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import pLimit from "p-limit";
import { progressBar } from 'progress-bar-cli'

dotenv.config()

// Validate required environment variables
const requiredEnvVars = [
  'CLIENT_PATH',
  'R2_CDN_URL',
  'S3_ENDPOINT',
  'R2_REGION',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET'
]

const missingVars = requiredEnvVars.filter(varName => !process.env[varName])

if (missingVars.length > 0) {
  console.error('❌ Erro: Variáveis de ambiente faltando no arquivo .env:')
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`)
  })
  console.error('\n💡 Dica: Verifique se o arquivo .env existe na pasta ot-launcher-uploader')
  console.error('   e se todas as variáveis estão definidas corretamente.')
  process.exit(1)
}

const limit = pLimit(parseInt(process.env.UPLOAD_CONCURRENCY) || 5);

const DEFAULT_MANIFEST = {}
const MANIFEST_URL = process.env.R2_CDN_URL

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.R2_REGION,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
})

async function fetchManifest() {
  try {
    const response = await axios.get(`${MANIFEST_URL}/manifest.json`, {
      headers: {
        'Cache-Control': 'no-cache'
      }
    })

    if (response.status !== 200 || !response.data) {
      return DEFAULT_MANIFEST
    }

    return response.data
  } catch {
    return DEFAULT_MANIFEST
  }
}

function readDirRecursive(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relativePath = path.relative(baseDir, fullPath)

    if (entry.isDirectory()) {
      files.push(...readDirRecursive(fullPath, baseDir))
    } else if (entry.isFile()) {
      files.push({
        fullPath,
        relativePath: relativePath.replace(/\\/g, '/')
      })
    }
  }

  return files
}

async function readClientFiles() {
  const clientDir = path.resolve(process.env.CLIENT_PATH)
  
  if (!fs.existsSync(clientDir)) {
    console.error(`❌ Erro: A pasta do cliente não existe: ${clientDir}`)
    console.error('   Verifique se o caminho CLIENT_PATH no arquivo .env está correto.')
    process.exit(1)
  }
  
  const files = readDirRecursive(clientDir)
  const localFiles = {}

  const tasks = files.map(
    (file) =>
      new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5')
        const stream = fs.createReadStream(file.fullPath)

        stream.on('data', (data) => hash.update(data))
        stream.on('end', () => {
          localFiles[file.relativePath] = {
            size: fs.statSync(file.fullPath).size,
            hash: hash.digest('hex')
          }
          resolve()
        })
        stream.on('error', reject)
      })
  )

  await Promise.all(tasks)
  return localFiles
}

async function uploadFileToR2(localPath, remotePath, contentType = 'application/octet-stream') {
  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: remotePath,
    Body: fs.createReadStream(localPath),
    ContentType: contentType
  })

  await s3Client.send(command)
}

const manifest = await fetchManifest()
const localFiles = await readClientFiles()

const clientDir = path.resolve(process.env.CLIENT_PATH)
const tasks = []
let completed = 0
let total = 0
for (const [filePath, fileInfo] of Object.entries(localFiles)) {
  const manifestFile = manifest[filePath]
  if (!manifestFile || manifestFile.hash !== fileInfo.hash) {
    total++
  }
}

const now = new Date()
for (const [filePath, fileInfo] of Object.entries(localFiles)) {
  const absolutePath = path.join(clientDir, filePath)
  const manifestFile = manifest[filePath]
  if (!manifestFile || manifestFile.hash !== fileInfo.hash) {
    tasks.push(limit(async () => {
      await uploadFileToR2(absolutePath, filePath)
      progressBar(++completed, total, now)
    }))
  }
}

await Promise.all(tasks)

fs.writeFileSync('manifest.json', JSON.stringify(localFiles))
await uploadFileToR2('manifest.json', 'manifest.json', 'application/json')
fs.unlinkSync('manifest.json')

console.log("\nUpload completed.")
