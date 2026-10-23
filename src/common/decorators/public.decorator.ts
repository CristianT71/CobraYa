import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca una ruta como pública: el guard de API key no la protege (solo /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
