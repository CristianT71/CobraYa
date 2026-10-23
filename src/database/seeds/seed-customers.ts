import dataSource from '../data-source';
import { Customer } from '../../customers/customer.entity';

const seedCustomers: Array<Pick<Customer, 'documentType' | 'documentNumber' | 'fullName'>> = [
    { documentType: 'CC', documentNumber: '1032456789', fullName: 'Cliente de ejemplo' },
    { documentType: 'NIT', documentNumber: '900123456', fullName: 'Transportes de Prueba S.A.S.' },
    { documentType: 'CE', documentNumber: '4567890', fullName: 'Cliente Extranjero de Prueba' },
    // Mismo número que el anterior con otro tipo: sirve para probar AMBIGUOUS_CUSTOMER
    { documentType: 'CC', documentNumber: '4567890', fullName: 'Cliente Ambiguo de Prueba' },
];

async function runSeed(): Promise<void> {
    await dataSource.initialize();
    try {
        await dataSource
            .createQueryBuilder()
            .insert()
            .into(Customer)
            .values(seedCustomers)
            .orIgnore()
            .execute();
        console.log(`Semilla aplicada: ${seedCustomers.length} clientes de prueba.`);
    } finally {
        await dataSource.destroy();
    }
}

runSeed().catch((error) => {
    console.error('Error al aplicar la semilla:', error);
    process.exit(1);
});