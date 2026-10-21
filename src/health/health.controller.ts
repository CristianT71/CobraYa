import { Controller, Get, Optional, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';

export interface HealthStatus {
  status: 'ok' | 'error';
  database: 'up' | 'down';
  uptime_s: number;
}

@ApiTags('operativo')
@Controller('health')
export class HealthController {
  constructor(@Optional() private readonly dataSource?: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Estado del servicio y de la conexión a PostgreSQL',
  })
  @ApiResponse({
    status: 200,
    description: 'Servicio y base de datos disponibles',
  })
  @ApiResponse({ status: 503, description: 'La base de datos no responde' })
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthStatus> {
    const databaseUp = await this.pingDatabase();
    res.status(databaseUp ? 200 : 503);
    return {
      status: databaseUp ? 'ok' : 'error',
      database: databaseUp ? 'up' : 'down',
      uptime_s: Math.round(process.uptime()),
    };
  }

  private async pingDatabase(): Promise<boolean> {
    if (!this.dataSource?.isInitialized) return false;
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
