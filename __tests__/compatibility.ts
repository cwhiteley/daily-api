import { Connection, getConnection } from 'typeorm';
import createApolloServer from '../src/apollo';
import { Context } from '../src/Context';
import { MockContext, saveFixtures } from './helpers';
import {
  ApolloServerTestClient,
  createTestClient,
} from 'apollo-server-testing';
import {
  Bookmark,
  Feed,
  FeedTag,
  Post,
  PostTag,
  Source,
  SourceDisplay,
  View,
} from '../src/entity';
import { sourcesFixture } from './fixture/source';
import { sourceDisplaysFixture } from './fixture/sourceDisplay';
import { postsFixture, postTagsFixture } from './fixture/post';
import { ApolloServer } from 'apollo-server-fastify';
import { FeedSource } from '../src/entity/FeedSource';
import { mocked } from 'ts-jest/utils';
import { getPostsIndex } from '../src/common';
import { SearchIndex } from 'algoliasearch';

let con: Connection;
let server: ApolloServer;
let client: ApolloServerTestClient;
let loggedUser: string = null;

jest.mock('../src/common/algolia', () => ({
  ...jest.requireActual('../src/common/algolia'),
  getPostsIndex: jest.fn(),
}));

beforeAll(async () => {
  con = await getConnection();
  server = await createApolloServer({
    context: (): Context => new MockContext(con, loggedUser),
    playground: false,
  });
  client = createTestClient(server);
});

beforeEach(async () => {
  loggedUser = null;

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, SourceDisplay, sourceDisplaysFixture);
  await saveFixtures(con, Post, postsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
});

const saveFeedFixtures = async (): Promise<void> => {
  await saveFixtures(con, Feed, [{ id: '1', userId: '1' }]);
  await saveFixtures(con, FeedTag, [
    { feedId: '1', tag: 'html' },
    { feedId: '1', tag: 'javascript' },
  ]);
  await saveFixtures(con, FeedSource, [
    { feedId: '1', sourceId: 'b' },
    { feedId: '1', sourceId: 'c' },
  ]);
};

const now = new Date();
const bookmarksFixture = [
  {
    userId: '1',
    postId: 'p3',
    createdAt: new Date(now.getTime() - 1000),
  },
  {
    userId: '1',
    postId: 'p1',
    createdAt: new Date(now.getTime() - 2000),
  },
  {
    userId: '1',
    postId: 'p5',
    createdAt: new Date(now.getTime() - 3000),
  },
];

const feedFields = `
    id
    url
    title
    readTime
    tags
    publication {
      id
      name
      image
    }
`;

describe('query latest', () => {
  const QUERY = `
  query Latest($params: QueryPostInput) {
    latest(params: $params) {
      ${feedFields}
    }
  }`;

  it('should return anonymous feed with no filters ordered by popularity', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed with no filters ordered by time', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, sortBy: 'creation' } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by sources', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, pubs: 'a,b' } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return anonymous feed filtered by tags', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, tags: 'html,webdev' } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return feed with preconfigured filters', async () => {
    const latest = new Date().toISOString();
    loggedUser = '1';
    await saveFeedFixtures();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest } },
    });
    expect(res.data).toMatchSnapshot();
  });

  it('should return unread posts from preconfigured feed', async () => {
    const latest = new Date().toISOString();
    loggedUser = '1';
    await saveFeedFixtures();
    await con.getRepository(View).save([{ userId: '1', postId: 'p1' }]);
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, read: false } },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query bookmarks', () => {
  const QUERY = `
  query Bookmarks($params: QueryPostInput) {
    bookmarks(params: $params) {
      ${feedFields}
    }
  }`;

  it('should return bookmarks ordered by time', async () => {
    const latest = new Date().toISOString();
    loggedUser = '1';
    await saveFixtures(con, Bookmark, bookmarksFixture);
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest } },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query postsByPublication', () => {
  const QUERY = `
  query PostsByPublication($params: PostByPublicationInput) {
    postsByPublication(params: $params) {
      ${feedFields}
    }
  }`;

  it('should return a single source feed', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, pub: 'b' } },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query postsByTag', () => {
  const QUERY = `
  query PostsByTag($params: PostByTagInput) {
    postsByTag(params: $params) {
      ${feedFields}
    }
  }`;

  it('should return a single tag feed', async () => {
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, tag: 'javascript' } },
    });
    expect(res.data).toMatchSnapshot();
  });
});

describe('query search', () => {
  const QUERY = `
  query Search($params: PostSearchInput) {
    search(params: $params) {
      query
      hits {
        ${feedFields}
      }
    }
  }`;

  it('should return search feed', async () => {
    const searchMock = jest.fn();
    mocked(getPostsIndex).mockReturnValue(({
      search: searchMock,
    } as unknown) as SearchIndex);
    searchMock.mockResolvedValue({
      hits: [{ objectID: 'p3' }, { objectID: 'p1' }],
    });
    const latest = new Date().toISOString();
    const res = await client.query({
      query: QUERY,
      variables: { params: { latest, query: 'text' } },
    });
    expect(searchMock).toBeCalledWith('text', expect.anything());
    expect(res.data).toMatchSnapshot();
  });
});

describe('query searchPostSuggestions', () => {
  const QUERY = `
  query SearchSuggestion($params: PostSearchSuggestionInput) {
    searchSuggestion(params: $params) {
      query
      hits {
        title
      }
    }
  }
`;

  it('should return search suggestions', async () => {
    const searchMock = jest.fn();
    mocked(getPostsIndex).mockReturnValue(({
      search: searchMock,
    } as unknown) as SearchIndex);
    searchMock.mockResolvedValue({
      hits: [
        {
          objectID: '1',
          title: 'title',
          _highlightResult: { title: { value: '<strong>t</strong>itle' } },
        },
      ],
    });
    const res = await client.query({
      query: QUERY,
      variables: { params: { query: 'text' } },
    });
    expect(searchMock).toBeCalledWith('text', expect.anything());
    expect(res.data).toMatchSnapshot();
  });
});
