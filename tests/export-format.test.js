import { describe, expect, it, vi } from 'vitest';
import { ExportFormat } from '../js/core/export-format.js';

describe('export-format', () => {
    it('validates required export fields', () => {
        const valid = ExportFormat.validate({
            version: ExportFormat.VERSION,
            source: ExportFormat.SOURCES.LINKAGE_LAB,
            timestamp: new Date().toISOString(),
        });
        expect(valid.valid).toBe(true);
        expect(valid.errors).toHaveLength(0);
    });

    it('rejects missing version and source', () => {
        const result = ExportFormat.validate({});
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Missing version field');
        expect(result.errors).toContain('Missing source field');
    });

    it('migrates version 1 exports to version 2', () => {
        const migrated = ExportFormat.migrate({ version: 1, source: ExportFormat.SOURCES.LINKAGE_LAB });
        expect(migrated.version).toBe(2);
        expect(migrated.automation).toBeDefined();
    });

    it('builds import URLs with source parameter', () => {
        const url = ExportFormat.buildImportURL('http://localhost:8000/solar_designer.html', 'linkageLab');
        expect(url).toContain('import=linkageLab');
    });

    it('builds unified app URLs with hash routes', () => {
        vi.stubGlobal('location', { href: 'http://localhost:8000/index.html' });
        const url = ExportFormat.buildUnifiedAppURL('solar-design', { importSource: 'linkageLab' });
        expect(url).toContain('index.html');
        expect(url).toContain('#/solar/design');
        expect(url).toContain('import=linkageLab');
    });
});
