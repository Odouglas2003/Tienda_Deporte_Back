import { Module } from '@nestjs/common'
import { VatRatesService } from './vat-rates.service'

@Module({ providers: [VatRatesService], exports: [VatRatesService] })
export class VatRatesModule {}
