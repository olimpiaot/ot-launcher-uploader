import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

console.log('🔍 Verificando variáveis de ambiente...\n')

const requiredVars = {
  'CLIENT_PATH': 'Caminho para a pasta do cliente',
  'R2_CDN_URL': 'URL pública do CDN R2',
  'S3_ENDPOINT': 'Endpoint S3 do R2',
  'R2_REGION': 'Região do R2',
  'R2_ACCESS_KEY_ID': 'Access Key ID do R2',
  'R2_SECRET_ACCESS_KEY': 'Secret Access Key do R2',
  'R2_BUCKET': 'Nome do bucket R2'
}

let hasErrors = false

for (const [varName, description] of Object.entries(requiredVars)) {
  const value = process.env[varName]
  
  if (!value) {
    console.error(`❌ ${varName}: NÃO DEFINIDA`)
    console.error(`   ${description}`)
    hasErrors = true
  } else {
    console.log(`✅ ${varName}: ${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`)
    
    // Validação especial para CLIENT_PATH
    if (varName === 'CLIENT_PATH') {
      const resolvedPath = path.resolve(value)
      if (!fs.existsSync(resolvedPath)) {
        console.error(`   ⚠️  AVISO: A pasta não existe: ${resolvedPath}`)
        hasErrors = true
      } else {
        console.log(`   ✅ Pasta existe: ${resolvedPath}`)
      }
    }
  }
}

console.log('\n' + '='.repeat(60))

if (hasErrors) {
  console.error('\n❌ Erros encontrados! Corrija o arquivo .env e tente novamente.')
  process.exit(1)
} else {
  console.log('\n✅ Todas as variáveis estão configuradas corretamente!')
  process.exit(0)
}

