# Implement red packet on solana
original code:
https://github.com/DimensionDev/RedPacket/
## Get Started
```
anchor build

anchor test
```
** right now, withdraw test pass will fail, because time check. Maybe need to use bank rewrite withdraw test.

## Todo List

feature:
- [ ] red packet ID design (frontend generate(maybe failed) / rust code generate(storage cost, need to notify frontend, redPacket id))
- [ ] claim red packet with signature issued by frontend
- [ ] random amount red packet
- [ ] bank run test and add more test cases
- [ ] upgrade program
- [ ] NFT red packet

# Reference:
https://github.com/solana-developers/developer-bootcamp-2024
