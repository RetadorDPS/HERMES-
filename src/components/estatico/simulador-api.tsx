'use client';

/**
 * Activa el «servidor de demostración» del navegador. Solo existe en la
 * versión estática (GitHub Pages); en el servidor normal no hace nada.
 */
import { instalarSimuladorApi } from '@/lib/simulador-api';

instalarSimuladorApi();

export function SimuladorApi() {
  return null;
}
