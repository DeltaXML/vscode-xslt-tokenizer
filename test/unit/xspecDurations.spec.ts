import { expect } from 'chai';
import { XSpecTests } from '../../src/xspecTests';

// XSpec's result XML with measure-time - as XSpec 4.1.2 writes it, run with Saxon-PE 13 (trimmed)
const report = `<report xmlns="http://www.jenitennison.com/xslt/xspec" xspec="file:/work/order-report.xspec" stylesheet="file:/work/order-report.xsl" date="2026-11-09T17:23:19.5Z">
   <scenario id="scenario1" xspec="file:/work/order-report.xspec">
      <label>o:line-total</label>
      <timestamp at="2026-11-09T17:23:19.550447Z" event="start"/>
      <scenario id="scenario1-scenario1" xspec="file:/work/order-report.xspec">
         <label>a line under 10 items</label>
         <timestamp at="2026-11-09T17:23:19.551429Z" event="start"/>
         <result select="25.0"/>
         <test id="scenario1-scenario1-expect1" successful="true">
            <label>is the quantity times the price</label>
         </test>
         <test id="scenario1-scenario1-expect2" successful="false">
            <label>is a decimal</label>
            <expect select="25"/>
         </test>
         <timestamp at="2026-11-09T17:23:19.552932Z" event="end"/>
      </scenario>
      <timestamp at="2026-11-09T17:23:19.565703Z" event="end"/>
   </scenario>
   <scenario id="scenario2" xspec="file:/work/order-report.xspec" pending="to do">
      <label>a negative amount</label>
      <test id="scenario2-expect1" pending="to do">
         <label>is shown in brackets</label>
      </test>
   </scenario>
</report>`;

describe('XSpec durations', () => {
    it('gives each scenario its time, and each expectation its scenario\'s', () => {
        const results = XSpecTests.parseResults(report);
        const duration = (...labels: string[]) => results.find((r) => r.labelPath.join(' > ') === labels.join(' > '))?.duration;
        // to the microsecond
        expect(duration('o:line-total', 'a line under 10 items')).to.be.closeTo(1.503, 1e-6);
        expect(duration('o:line-total', 'a line under 10 items', 'is the quantity times the price')).to.be.closeTo(1.503, 1e-6);
        expect(duration('o:line-total', 'a line under 10 items', 'is a decimal')).to.be.closeTo(1.503, 1e-6);
        // an outer scenario's time includes its inner scenarios'
        expect(duration('o:line-total')).to.be.closeTo(15.256, 1e-6);
    });

    it('gives none without measure-time, and none to a pending expectation', () => {
        const results = XSpecTests.parseResults(report.replace(/<timestamp[^>]*\/>/g, ''));
        expect(results.every((r) => r.duration === undefined)).to.equal(true);
        expect(XSpecTests.parseResults(report).find((r) => r.labelPath[r.labelPath.length - 1] === 'is shown in brackets')?.duration).to.equal(undefined);
    });

    it('gives the time of the whole run from the report\'s own timestamps', () => {
        const withRunTimes = report
            .replace('date="2026-11-09T17:23:19.5Z">', 'date="2026-11-09T17:23:19.5Z">\n   <timestamp at="2026-11-09T17:23:19.550000Z" event="start"/>')
            .replace('</report>', '   <timestamp at="2026-11-09T17:23:19.586700Z" event="end"/>\n</report>');
        expect(XSpecTests.testsElapsed(withRunTimes)).to.be.closeTo(36.7, 1e-6);
        // only the report's own, not a scenario's
        expect(XSpecTests.testsElapsed(report)).to.equal(undefined);
    });

    it('measures between timestamps with a fraction or a time zone, and not with one missing', () => {
        expect(XSpecTests.elapsed('2026-11-09T17:23:19Z', '2026-11-09T17:23:20.25Z')).to.equal(1250);
        expect(XSpecTests.elapsed('2026-11-09T18:00:00.5+01:00', '2026-11-09T17:00:01Z')).to.be.closeTo(500, 1e-9);
        expect(XSpecTests.elapsed('2026-11-09T17:23:19Z', undefined)).to.equal(undefined);
        expect(XSpecTests.elapsed('not a time', '2026-11-09T17:23:19Z')).to.equal(undefined);
    });
});
