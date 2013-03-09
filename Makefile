test:
	mocha \
		--require should \
		--reporter spec \
		--growl \
		--ui bdd \
		test/$(js)

docs: test-docs

test-docs:
	mocha \
		--require should \
		--reporter doc \
		--timeout 30000 \
		--growl \
		--ui bdd \
		test/$(js) \
		| cat test/docs/head.html - test/docs/tail.html \
		> test/docs/test.html

.PHONY: test docs test-docs