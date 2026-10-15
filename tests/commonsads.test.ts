import { describe, expect, it } from 'vitest'
import { confirmedPublicDomain, newspaperOf, parseCommonsAd } from '../electron/services/commonsads'

const file = {
  pageid: 1,
  title: 'File:ELECTRIC SUSPENSORY (1905 advertisement).jpg',
  url: 'https://upload.wikimedia.org/x.jpg',
  descriptionurl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
  license: 'Public domain',
  licenseCode: 'pd',
  copyrighted: 'False',
  categories: 'PD US expired|1905 advertisements in the United States',
  credit:
    '<a href="http://chroniclingamerica.loc.gov/lccn/sn85042462/1905-01-01/ed-1/seq-6/">http://chroniclingamerica.loc.gov/lccn/sn85042462/1905-01-01/ed-1/seq-6/</a>   (Los Angeles Herald)',
  description: 'in 1905, this advertisement appeared in the Los Angeles Herald.'
}

describe('Chronicling America ads mirrored on Commons', () => {
  it('reads the LoC page, date and newspaper', () => {
    const p = parseCommonsAd(file)
    expect(p?.id).toBe('sn85042462/1905-01-01/ed-1/seq-6')
    expect(p?.date).toBe('1905-01-01')
    expect(p?.page).toBe(6)
    expect(p?.newspaper).toBe('Los Angeles Herald')
    expect(p?.mirror).toBe(file.url)
  })

  it('refuses files after 1930, without a LoC source or not public domain', () => {
    expect(parseCommonsAd({ ...file, credit: file.credit.split('1905').join('1941') })).toBeNull()
    expect(parseCommonsAd({ ...file, credit: 'scanned by me' })).toBeNull()
    expect(parseCommonsAd({ ...file, licenseCode: 'cc-by-sa-4.0' })).toBeNull()
  })

  it('finds the newspaper in the usual Commons wordings', () => {
    expect(newspaperOf('Source "The Banner-Democrat" (Lake Providence, Louisiana)')).toBe(
      'The Banner-Democrat'
    )
  })
})

describe('LoC citation style', () => {
  it('reads the paper and place from "Title. (City, State), date"', () => {
    const p = parseCommonsAd({
      ...file,
      credit:
        'El Paso herald. (El Paso, Tex.), 20 June 1913. Chronicling America: Historic American Newspapers. Lib. of Congress. &lt;http://chroniclingamerica.loc.gov/lccn/sn88084272/1913-06-20/ed-1/seq-9/&gt;'
    })
    expect(p?.newspaper).toBe('El Paso Herald')
    expect(p?.city).toBe('El Paso')
    expect(p?.state).toBe('Tex.')
  })
})

describe('Commons license filter', () => {
  it('needs public domain confirmed on the file page and keeps it for the credit', () => {
    expect(confirmedPublicDomain(file)).toBe('Public domain (PD-US-expired)')
    expect(parseCommonsAd(file)?.license).toBe('Public domain (PD-US-expired)')
    expect(confirmedPublicDomain({ ...file, copyrighted: 'True' })).toBeNull()
    expect(confirmedPublicDomain({ ...file, categories: 'Advertisements' })).toBeNull()
    expect(confirmedPublicDomain({ ...file, licenseCode: '' })).toBeNull()
  })
})
