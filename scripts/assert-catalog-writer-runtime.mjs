#!/usr/bin/env node
import 'dotenv/config'
import { assertCatalogWriterRuntimeProof } from './catalog-writer-runtime-guard.mjs'

assertCatalogWriterRuntimeProof(process.env)
